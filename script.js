const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
if (!gl) {
  alert("WebGL not supported");
}

// Resize logic
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Compile utility
function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

// Vertex shader (quad)
const vSrc = `#version 300 es
in vec4 a_position;
out vec2 v_uv;
void main() {
  v_uv = (a_position.xy + 1.0) * 0.5;
  gl_Position = a_position;
}`;

// Fragment shader — more complex, incorporating starfield, globe, bursts
const fSrc = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_prevFrame;
uniform float u_hueOffset;
uniform float u_glow;
uniform float u_starDensity;
uniform float u_burstStr;
uniform float u_feedback;
uniform float u_freqScale;
uniform float u_spectrum[256];

in vec2 v_uv;
out vec4 outColor;

// helper: hue → RGB
vec3 hue2rgb(float h) {
  float r = abs(h * 6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h * 6.0 - 2.0);
  float b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

// 2D noise pseudo
float pn(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// starfield
float star(vec2 uv, float density) {
  // random stars: threshold
  float v = pn(uv * density * 100.0 + u_time * 0.1);
  return step(0.995, v);  // very sparse
}

// wireframe globe (projected circle + grid lines)
float globeGrid(vec2 uv) {
  vec2 c = uv - 0.5;
  float dist = length(c);
  if (dist > 0.5) return 0.0;
  // grid lines by angle & radius steps
  float ang = atan(c.y, c.x) / 3.14159; // -1..1
  float r = dist * 2.0;
  float line1 = abs(fract(r * 10.0) - 0.5);
  float line2 = abs(fract(ang * 10.0) - 0.5);
  float f = min(line1, line2);
  return smoothstep(0.02, 0.0, f);
}

void main() {
  vec2 uv = v_uv;
  vec3 col = vec3(0.0);

  // starfield base
  float s = star(uv, u_starDensity);
  col += vec3(s);

  // add wireframe globe
  float g = globeGrid(uv);
  col += vec3(g * 0.5);

  // spectrum / burst logic
  float hi = u_spectrum[120] / 255.0;
  float burst = smoothstep(0.6, 0.0, 1.0 - hi) * u_burstStr;

  // pulses or warps
  vec2 c = uv - 0.5;
  float dist = length(c);
  float angle = atan(c.y, c.x);
  float wave = sin(angle * 20.0 + u_time * 2.0 + hi * 5.0) * 0.02 * hi * u_freqScale;
  float warpy = dist + wave;

  float mask = smoothstep(0.5, 0.45, warpy);

  // color
  float hue = mod(u_hueOffset / 360.0 + hi + u_time * 0.05, 1.0);
  vec3 base = hue2rgb(hue);
  col += base * mask * u_glow;

  // burst overlay
  col += vec3(burst);

  // blend with previous frame (feedback)
  vec3 prev = texture(u_prevFrame, uv).rgb;
  vec3 mixed = mix(col, prev, u_feedback);

  outColor = vec4(mixed, 1.0);
}`;

// Build program
const vs = compileShader(gl.VERTEX_SHADER, vSrc);
const fs = compileShader(gl.FRAGMENT_SHADER, fSrc);
const program = gl.createProgram();
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  console.error("Program link error:", gl.getProgramInfoLog(program));
}

// Look up locations
const aPos = gl.getAttribLocation(program, 'a_position');
const uRes = gl.getUniformLocation(program, 'u_resolution');
const uTime = gl.getUniformLocation(program, 'u_time');
const uPrev = gl.getUniformLocation(program, 'u_prevFrame');
const uHue = gl.getUniformLocation(program, 'u_hueOffset');
const uGlow = gl.getUniformLocation(program, 'u_glow');
const uStarDen = gl.getUniformLocation(program, 'u_starDensity');
const uBurst = gl.getUniformLocation(program, 'u_burstStr');
const uFeedback = gl.getUniformLocation(program, 'u_feedback');
const uFreqScale = gl.getUniformLocation(program, 'u_freqScale');
const uSpectrum = gl.getUniformLocation(program, 'u_spectrum');

// Quad setup
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
const quadVerts = new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
  -1,  1,
   1, -1,
   1,  1
]);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

// Feedback framebuffers
function makeFB() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_2D, tex, 0);
  return { fb, tex };
}
let fbA = makeFB();
let fbB = makeFB();
let useA = true;

// Audio setup
let audioCtx, analyser, freqData;
const fileInput = document.getElementById('audiofile');
fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    if (audioCtx) audioCtx.close();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    audioCtx.decodeAudioData(ev.target.result, buffer => {
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      src.start(0);
    });
  };
  reader.readAsArrayBuffer(file);
});

function setSpectrum() {
  if (analyser && freqData) {
    analyser.getByteFrequencyData(freqData);
    gl.uniform1fv(uSpectrum, freqData);
  } else {
    const zeros = new Float32Array(256);
    gl.uniform1fv(uSpectrum, zeros);
  }
}

// UI elements
const hueSlider = document.getElementById('hueOff');
const glowSlider = document.getElementById('glowInt');
const starSlider = document.getElementById('starDensity');
const burstSlider = document.getElementById('burstStr');
const feedbackSlider = document.getElementById('feedbackAmt');
const freqSlider = document.getElementById('freqScale');

let start = performance.now();
function draw() {
  const now = performance.now();
  const t = (now - start) * 0.001;

  // swap buffers
  const srcFB = useA ? fbA : fbB;
  const dstFB = useA ? fbB : fbA;
  useA = !useA;

  // draw into dstFB
  gl.bindFramebuffer(gl.FRAMEBUFFER, dstFB.fb);
  gl.useProgram(program);

  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, t);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcFB.tex);
  gl.uniform1i(uPrev, 0);

  gl.uniform1f(uHue, parseFloat(hueSlider.value));
  gl.uniform1f(uGlow, parseFloat(glowSlider.value));
  gl.uniform1f(uStarDen, parseFloat(starSlider.value));
  gl.uniform1f(uBurst, parseFloat(burstSlider.value));
  gl.uniform1f(uFeedback, parseFloat(feedbackSlider.value));
  gl.uniform1f(uFreqScale, parseFloat(freqSlider.value));

  setSpectrum();

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // output to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, dstFB.tex);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

/**
 * The glow pass: WebGL2 post processing over the world canvas. Each frame the 2D world canvas is
 * uploaded as a texture and drawn back out through three small passes: a bright pass that keeps
 * only what shines (beams, fire, the sun, the white of a super), a separable blur of it at a
 * quarter of the size, and a composite that adds that bloom over the scene, bends the scene
 * through the shockwaves of the explosions, splits the colours apart after a heavy hit and
 * darkens the corners a little. The output is opaque and covers the world canvas; without WebGL2
 * (or with ?gl=0) there is no pass and the world canvas shows as it always did.
 *
 * The pass knows nothing of the game: game/post.ts turns events and the camera into GlowUniforms.
 * It is DOM and GPU only, so the unit tests cover the fallback and the shader text, and the
 * browser smoke covers the pass itself.
 */

export interface GlowWave {
  /** Centre in canvas px, y down. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly width: number;
  /** Displacement at the ring's crest, canvas px. */
  readonly strength: number;
}

export interface GlowUniforms {
  /** How much of the blurred bright pass is added back over the scene. */
  readonly bloom: number;
  /** Luminance (0..1) under which nothing blooms. */
  readonly threshold: number;
  /** Colour split at the screen's edge, canvas px. */
  readonly chroma: number;
  /** 0..1 darkening of the corners. */
  readonly vignette: number;
  readonly waves: readonly GlowWave[];
}

/** Shockwaves the composite shader bends the scene through at once; the newest win. */
export const MAX_WAVES = 8;

export interface GlowPass {
  readonly kind: 'webgl2';
  /** Draws the source (the world canvas) through the pass onto the glow canvas, sized to the source. */
  render(source: HTMLCanvasElement, uniforms: GlowUniforms): void;
  /** True once the context was lost: the pass draws nothing after that and should be dropped. */
  lost(): boolean;
  dispose(): void;
}

/** A full screen triangle from the vertex id alone: no buffers. */
export const VERTEX_SRC = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Keeps what shines: luminance over the threshold, eased in so edges do not flicker. */
export const BRIGHT_SRC = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform float uThreshold;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, 1.0, l);
  outColor = vec4(c * k, 1.0);
}
`;

/** One direction of a 9 tap Gaussian; uStep is one texel along that direction. */
export const BLUR_SRC = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uStep * float(i);
    c += texture(uTex, vUv + o).rgb * w[i];
    c += texture(uTex, vUv - o).rgb * w[i];
  }
  outColor = vec4(c, 1.0);
}
`;

/**
 * The scene bent through the shockwaves (the ring's crest pulls the picture outward), its colours
 * split toward the edges by uChroma, the bloom added, the corners darkened.
 */
export const COMPOSITE_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uSize;
uniform float uBloomStrength;
uniform float uChroma;
uniform float uVignette;
uniform int uWaveCount;
uniform vec4 uWaves[8];
uniform float uWaveStrength[8];
void main() {
  vec2 px = vec2(vUv.x * uSize.x, (1.0 - vUv.y) * uSize.y);
  vec2 shift = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uWaveCount) break;
    vec2 d = px - uWaves[i].xy;
    float dist = length(d);
    float band = (dist - uWaves[i].z) / max(uWaves[i].w, 1.0);
    float crest = exp(-band * band * 3.0);
    shift += (d / max(dist, 1.0)) * crest * uWaveStrength[i];
  }
  vec2 uv = vUv - vec2(shift.x, -shift.y) / uSize;
  vec2 toCentre = vUv - 0.5;
  vec2 ca = toCentre * (uChroma / uSize.x) * 2.0;
  float r = texture(uScene, uv + ca).r;
  float g = texture(uScene, uv).g;
  float b = texture(uScene, uv - ca).b;
  vec3 color = vec3(r, g, b) + texture(uBloom, uv).rgb * uBloomStrength;
  float edge = length(toCentre) * 1.4142;
  color *= 1.0 - uVignette * smoothstep(0.55, 1.15, edge);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  w: number;
  h: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (vs === null || fs === null || program === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  if (texture === null) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function makeTarget(gl: WebGL2RenderingContext): Target | null {
  const texture = makeTexture(gl);
  const framebuffer = gl.createFramebuffer();
  if (texture === null || framebuffer === null) return null;
  return { texture, framebuffer, w: 0, h: 0 };
}

function sizeTarget(gl: WebGL2RenderingContext, target: Target, w: number, h: number): void {
  if (target.w === w && target.h === h) return;
  target.w = w;
  target.h = h;
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
}

/** The context, or null when the browser has no WebGL2 (some refuse by returning null, some by throwing). */
function openContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  } catch {
    return null;
  }
}

/** Opens a WebGL2 context on the glow canvas and builds the pass; null when the browser cannot. */
export function createGlowPass(canvas: HTMLCanvasElement): GlowPass | null {
  const G = openContext(canvas);
  if (G === null) return null;
  const bright = link(G, BRIGHT_SRC);
  const blur = link(G, BLUR_SRC);
  const composite = link(G, COMPOSITE_SRC);
  const scene = makeTexture(G);
  const half = makeTarget(G);
  const quarterA = makeTarget(G);
  const quarterB = makeTarget(G);
  if (bright === null || blur === null || composite === null || scene === null || half === null || quarterA === null || quarterB === null) return null;

  const brightScene = G.getUniformLocation(bright, 'uScene');
  const brightThreshold = G.getUniformLocation(bright, 'uThreshold');
  const blurTex = G.getUniformLocation(blur, 'uTex');
  const blurStep = G.getUniformLocation(blur, 'uStep');
  const compScene = G.getUniformLocation(composite, 'uScene');
  const compBloom = G.getUniformLocation(composite, 'uBloom');
  const compSize = G.getUniformLocation(composite, 'uSize');
  const compBloomStrength = G.getUniformLocation(composite, 'uBloomStrength');
  const compChroma = G.getUniformLocation(composite, 'uChroma');
  const compVignette = G.getUniformLocation(composite, 'uVignette');
  const compWaveCount = G.getUniformLocation(composite, 'uWaveCount');
  const compWaves = G.getUniformLocation(composite, 'uWaves');
  const compWaveStrength = G.getUniformLocation(composite, 'uWaveStrength');
  const waveData = new Float32Array(MAX_WAVES * 4);
  const waveStrength = new Float32Array(MAX_WAVES);

  let lost = false;
  let sceneW = 0;
  let sceneH = 0;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });

  const blurPass = (from: WebGLTexture, to: Target, stepX: number, stepY: number): void => {
    G.bindFramebuffer(G.FRAMEBUFFER, to.framebuffer);
    G.viewport(0, 0, to.w, to.h);
    G.useProgram(blur);
    G.activeTexture(G.TEXTURE0);
    G.bindTexture(G.TEXTURE_2D, from);
    G.uniform1i(blurTex, 0);
    G.uniform2f(blurStep, stepX, stepY);
    G.drawArrays(G.TRIANGLES, 0, 3);
  };

  return {
    kind: 'webgl2',
    lost: () => lost,
    render: (source, uniforms) => {
      if (lost) return;
      const w = source.width;
      const h = source.height;
      if (w === 0 || h === 0) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      // The scene: the world canvas uploaded, flipped so its top is the texture's top in uv.
      G.activeTexture(G.TEXTURE0);
      G.bindTexture(G.TEXTURE_2D, scene);
      G.pixelStorei(G.UNPACK_FLIP_Y_WEBGL, true);
      if (sceneW !== w || sceneH !== h) {
        sceneW = w;
        sceneH = h;
        G.texImage2D(G.TEXTURE_2D, 0, G.RGBA, G.RGBA, G.UNSIGNED_BYTE, source);
        sizeTarget(G, half, Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
        sizeTarget(G, quarterA, Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
        sizeTarget(G, quarterB, Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)));
      } else {
        G.texSubImage2D(G.TEXTURE_2D, 0, 0, 0, G.RGBA, G.UNSIGNED_BYTE, source);
      }

      // Bright pass into the half size target.
      G.bindFramebuffer(G.FRAMEBUFFER, half.framebuffer);
      G.viewport(0, 0, half.w, half.h);
      G.useProgram(bright);
      G.uniform1i(brightScene, 0);
      G.uniform1f(brightThreshold, uniforms.threshold);
      G.drawArrays(G.TRIANGLES, 0, 3);

      // Two blurs each way at a quarter of the size, the second with a wider step for a softer halo.
      blurPass(half.texture, quarterA, 1 / half.w, 0);
      blurPass(quarterA.texture, quarterB, 0, 1 / quarterA.h);
      blurPass(quarterB.texture, quarterA, 2 / quarterB.w, 0);
      blurPass(quarterA.texture, quarterB, 0, 2 / quarterA.h);

      // The composite onto the canvas.
      const waves = uniforms.waves.slice(0, MAX_WAVES);
      waves.forEach((wave, i) => {
        waveData[i * 4] = wave.x;
        waveData[i * 4 + 1] = wave.y;
        waveData[i * 4 + 2] = wave.radius;
        waveData[i * 4 + 3] = wave.width;
        waveStrength[i] = wave.strength;
      });
      G.bindFramebuffer(G.FRAMEBUFFER, null);
      G.viewport(0, 0, w, h);
      G.useProgram(composite);
      G.activeTexture(G.TEXTURE0);
      G.bindTexture(G.TEXTURE_2D, scene);
      G.activeTexture(G.TEXTURE1);
      G.bindTexture(G.TEXTURE_2D, quarterB.texture);
      G.uniform1i(compScene, 0);
      G.uniform1i(compBloom, 1);
      G.uniform2f(compSize, w, h);
      G.uniform1f(compBloomStrength, uniforms.bloom);
      G.uniform1f(compChroma, uniforms.chroma);
      G.uniform1f(compVignette, uniforms.vignette);
      G.uniform1i(compWaveCount, waves.length);
      G.uniform4fv(compWaves, waveData);
      G.uniform1fv(compWaveStrength, waveStrength);
      G.drawArrays(G.TRIANGLES, 0, 3);
    },
    dispose: () => {
      lost = true;
      G.deleteProgram(bright);
      G.deleteProgram(blur);
      G.deleteProgram(composite);
      G.deleteTexture(scene);
      for (const target of [half, quarterA, quarterB]) {
        G.deleteTexture(target.texture);
        G.deleteFramebuffer(target.framebuffer);
      }
    },
  };
}

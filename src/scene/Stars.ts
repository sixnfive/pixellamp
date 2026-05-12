import * as THREE from 'three';
import { state } from '../state';

/**
 * Estrellas + luna. Las estrellas son Points en una esfera celeste
 * (radio < el sky-dome y > las nubes) con twinkle. La luna es un
 * billboard procedural opuesto al sol con una iluminación lambertiana
 * básica para que se vean fases.
 */

const starsVS = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute float aDensitySeed;
attribute vec3 aColor;
varying float vSeed;
varying vec3 vColor;
uniform float uPixelRatio;
uniform float uDensity;
void main(){
  vSeed = aSeed;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Soft density cutoff por estrella (cada una tiene su propio umbral)
  float visible = step(aDensitySeed, uDensity);
  gl_PointSize = aSize * uPixelRatio * visible;
  gl_Position.z = gl_Position.w;
}
`;

const starsFS = /* glsl */ `
precision highp float;
varying float vSeed;
varying vec3 vColor;
uniform float uTime;
uniform float uBrightness;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if(r > 0.5) discard;
  float core = exp(-r * 12.0);
  float glow = exp(-r * 4.0) * 0.25;
  float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + vSeed * 4.0) + vSeed * 6.28);
  vec3 col = vColor * (core + glow) * twinkle * uBrightness;
  gl_FragColor = vec4(col, core + glow);
}
`;

const moonVS = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const moonFS = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vWorldPos;
uniform vec3 uSunDir;
uniform float uBrightness;

// Hash & noise para "mares" lunares
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.1; a *= 0.5; }
  return v;
}

void main(){
  vec3 n = normalize(vNormal);
  // Aproximación: el sol está donde dice uSunDir; la luna se ilumina con él
  float ndl = max(dot(n, normalize(uSunDir)), 0.0);
  float halfL = 0.4 + 0.6 * ndl;

  // Textura procedural: mares y cráteres
  vec2 uv = vec2(atan(n.z, n.x) * 0.5, asin(n.y));
  float maria = fbm(uv * 4.0) * 0.6 + 0.4;
  float craters = fbm(uv * 16.0);
  craters = smoothstep(0.55, 0.7, craters);
  float albedo = mix(0.55, 0.78, maria) - craters * 0.15;

  vec3 col = vec3(albedo) * halfL * uBrightness;
  // Borde con un poquito de "Earthshine" muy tenue
  col += vec3(0.015, 0.02, 0.03) * (1.0 - ndl);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Stars {
  readonly group = new THREE.Group();
  readonly stars: THREE.Points;
  readonly moon: THREE.Mesh;
  readonly starMat: THREE.ShaderMaterial;
  readonly moonMat: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private moonDir = new THREE.Vector3(0, -1, 0);
  private moonRadius = 1500;
  private moonSize = 65;

  constructor(count = 6000) {
    // Estrellas
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    const densitySeeds = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const radius = 1700;
    for (let i = 0; i < count; i++) {
      // Distribución uniforme en una semi-esfera superior (ligeramente bajo el horizonte)
      const u = Math.random();
      const v = Math.random() * 2 - 1; // -1..1
      const theta = u * Math.PI * 2;
      const phi = Math.acos(Math.max(-0.1, v)); // sesgo hacia arriba
      const r = radius * (0.97 + Math.random() * 0.06);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Magnitud: pocas brillantes, muchas tenues (Pareto-ish)
      const mag = Math.pow(Math.random(), 4.5);
      sizes[i] = 1.2 + mag * 4.5;
      seeds[i] = Math.random();
      // densitySeed determina si está visible cuando el slider <= 1.
      // Las estrellas más brillantes siempre se ven antes (seed bajo).
      densitySeeds[i] = Math.pow(Math.random(), 1.0 + mag * 2.0);

      // Color: azuladas/blancas/algunas naranjas
      const t = Math.random();
      let cr = 1, cg = 1, cb = 1;
      if (t < 0.15) { cr = 1.0; cg = 0.78; cb = 0.6; }       // anaranjada
      else if (t < 0.35) { cr = 1.0; cg = 0.95; cb = 0.85; } // amarillenta
      else if (t < 0.7)  { cr = 1.0; cg = 1.0;  cb = 1.0; }  // blanca
      else { cr = 0.78; cg = 0.85; cb = 1.0; }               // azulada
      colors[i * 3 + 0] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geom.setAttribute('aDensitySeed', new THREE.BufferAttribute(densitySeeds, 1));
    geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    this.starMat = new THREE.ShaderMaterial({
      vertexShader: starsVS,
      fragmentShader: starsFS,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uDensity: { value: state.starsDensity },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.stars = new THREE.Points(geom, this.starMat);
    this.stars.renderOrder = -800;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Luna
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: moonVS,
      fragmentShader: moonFS,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uBrightness: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(this.moonSize, 32, 16), this.moonMat);
    this.moon.renderOrder = -700;
    this.group.add(this.moon);
  }

  setSunDirection(dir: THREE.Vector3) {
    this.sunDir.copy(dir);
  }

  setMoonDirection(dir: THREE.Vector3) {
    this.moonDir.copy(dir).normalize();
    this.moon.position.copy(this.moonDir).multiplyScalar(this.moonRadius);
    this.moon.lookAt(0, 0, 0);
  }

  update(timeSeconds: number) {
    this.starMat.uniforms.uTime.value = timeSeconds;
    this.starMat.uniforms.uDensity.value = state.starsDensity;
    // Las estrellas se encienden cuando el sol está claramente bajo el horizonte
    const sunY = this.sunDir.y;
    const night = THREE.MathUtils.clamp(-sunY / 0.2, 0, 1);
    this.starMat.uniforms.uBrightness.value = night * state.starsBrightness;
    // La luna se ve incluso de día atenuada
    this.moonMat.uniforms.uBrightness.value = THREE.MathUtils.clamp(0.4 + night * 2.0, 0, 3.0);
    // Tamaño en vivo
    this.moon.scale.setScalar(state.moonSize);
    // Ocúltala si está bajo el horizonte para no clavar un disco oscuro
    this.moon.visible = this.moonDir.y > -0.05;
  }
}

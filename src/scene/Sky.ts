import * as THREE from 'three';
import { state } from '../state';

/**
 * Cielo con scattering atmosférico realista (Rayleigh + Mie + ozono)
 * resuelto por raymarching con la tierra como esfera de radio 6360km.
 *
 * Inspirado en:
 *  - Nishita 1993 (display of the earth taking into account atmospheric scattering)
 *  - Bruneton/Hillaire (precomputed atmospheric scattering)
 *  - sky-pro / dangreenheck (sampling atmosférico + light marching)
 *
 * Hace `N_VIEW` pasos a lo largo del rayo de cámara y `N_LIGHT` pasos
 * desde cada muestra hacia el sol, lo que da unos atardeceres con
 * banda magenta–naranja correcta y un crepúsculo civil creíble.
 */

const vertexShader = /* glsl */ `
varying vec3 vWorldDir;

void main(){
  vWorldDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pegar al far plane
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec3 vWorldDir;

uniform vec3 uSunDir;
uniform float uRayleigh;
uniform float uMie;
uniform float uMieG;
uniform float uTurbidity;
uniform float uOzone;
uniform float uSunIntensity;
uniform float uSunSize;
uniform float uNightLift; // pequeña luz residual de noche
uniform vec3 uGroundAlbedo;

const float PI = 3.141592653589793;

const float R_EARTH = 6360e3;
const float R_ATMOS = 6420e3;
const float H_R = 8000.0;
const float H_M = 1200.0;

const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BETA_M = vec3(3.996e-6);
const vec3 BETA_MABS = vec3(4.4e-6);
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);

const int N_VIEW = 16;
const int N_LIGHT = 6;

vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r*r;
  float h = b*b - c;
  if(h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 densityAt(vec3 p){
  float h = max(length(p) - R_EARTH, 0.0);
  float dr = exp(-h / H_R);
  float dm = exp(-h / H_M) * uTurbidity;
  // Ozono: "triangular" centrado en 25km, ancho 15km (aprox. Bruneton)
  float doz = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return vec3(dr, dm, doz);
}

vec3 opticalDepth(vec3 ro, vec3 rd, float dist){
  float ds = dist / float(N_LIGHT);
  vec3 od = vec3(0.0);
  for(int i=0;i<N_LIGHT;i++){
    vec3 p = ro + rd * (float(i) + 0.5) * ds;
    od += densityAt(p) * ds;
  }
  return od;
}

vec3 tauFromOD(vec3 od){
  return BETA_R * uRayleigh * od.x
       + (BETA_M + BETA_MABS) * uMie * od.y
       + BETA_O * uOzone * od.z;
}

void scatter(vec3 ro, vec3 rd, vec3 sunDir, out vec3 inscatter, out vec3 transmittance){
  vec2 tAt = raySphere(ro, rd, R_ATMOS);
  vec2 tEa = raySphere(ro, rd, R_EARTH);
  inscatter = vec3(0.0);
  transmittance = vec3(1.0);
  if(tAt.y < 0.0) return;

  float tStart = max(0.0, tAt.x);
  float tEnd = tAt.y;
  bool hitGround = false;
  if(tEa.x > 0.0){
    tEnd = min(tEnd, tEa.x);
    hitGround = true;
  }
  float segLen = tEnd - tStart;
  if(segLen <= 0.0) return;

  float ds = segLen / float(N_VIEW);
  vec3 odView = vec3(0.0);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);

  for(int i=0;i<N_VIEW;i++){
    float t = tStart + (float(i) + 0.5) * ds;
    vec3 p = ro + rd * t;
    vec3 d = densityAt(p);
    odView += d * ds;

    vec2 ts = raySphere(p, sunDir, R_ATMOS);
    vec2 tge = raySphere(p, sunDir, R_EARTH);
    bool shadowed = (tge.x > 0.0 && tge.x < ts.y);
    if(ts.y > 0.0 && !shadowed){
      vec3 odLight = opticalDepth(p, sunDir, ts.y);
      vec3 tau = tauFromOD(odView + odLight);
      vec3 attn = exp(-tau);
      sumR += attn * d.x * ds;
      sumM += attn * d.y * ds;
    }
  }

  // Fase Rayleigh y Mie (Henyey-Greenstein modificado)
  float mu = dot(rd, sunDir);
  float mu2 = mu * mu;
  float phaseR = (3.0 / (16.0 * PI)) * (1.0 + mu2);
  float g = uMieG;
  float g2 = g * g;
  float denom = pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
  float phaseM = (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu2)) / ((2.0 + g2) * denom);

  inscatter = uSunIntensity * (
      BETA_R * uRayleigh * sumR * phaseR
    + BETA_M * uMie     * sumM * phaseM
  );
  transmittance = exp(-tauFromOD(odView));

  if(hitGround){
    // Suelo lambertiano muy tenue (queda casi siempre tapado por el paisaje real)
    vec3 groundPos = ro + rd * tEnd;
    vec3 n = normalize(groundPos);
    float ndl = max(dot(n, sunDir), 0.0);
    vec3 sunTrans = exp(-tauFromOD(opticalDepth(groundPos, sunDir, max(raySphere(groundPos, sunDir, R_ATMOS).y, 0.0))));
    vec3 ground = uGroundAlbedo * (ndl * uSunIntensity * sunTrans + 0.02);
    inscatter += transmittance * ground;
  }
}

vec3 sunDisc(vec3 rd, vec3 sunDir, vec3 trans, float sunY){
  float cosAng = clamp(dot(rd, sunDir), -1.0, 1.0);
  float ang = acos(cosAng);
  float disc = radians(0.53 * uSunSize);
  // Disco con borde suave (más visible que el sol real, está bien aquí)
  float core = 1.0 - smoothstep(disc * 0.78, disc * 1.05, ang);
  // Halo interno (corona) y halo exterior (god-ray) más amplios al amanecer/atardecer
  float lowSun = 1.0 - smoothstep(0.0, 0.35, sunY);
  float halo  = exp(-pow(ang / (disc * 5.0), 2.0)) * 0.35;
  float godRay = exp(-pow(ang / (disc * 14.0), 2.0)) * 0.55 * lowSun;
  // Limb darkening del disco
  float mu = max(0.0, 1.0 - ang / disc);
  float limb = mix(0.55, 1.0, pow(mu, 0.45));
  // Color del disco: blanco al mediodía, ámbar/escarlata cerca del horizonte
  vec3 cWarm = vec3(1.0, 0.55, 0.25);
  vec3 cWhite = vec3(1.0, 0.96, 0.86);
  vec3 sunCol = mix(cWarm, cWhite, smoothstep(0.0, 0.35, sunY));
  return sunCol * uSunIntensity * (core * 110.0 * limb + halo + godRay) * trans;
}

void main(){
  vec3 rd = normalize(vWorldDir);
  // Cámara ~3m sobre el suelo en espacio "earth"
  vec3 ro = vec3(0.0, R_EARTH + 3.0, 0.0);
  vec3 sunDir = normalize(uSunDir);

  vec3 inscatter, trans;
  scatter(ro, rd, sunDir, inscatter, trans);

  // Disco solar (sólo si el sol está sobre/cerca del horizonte)
  if(sunDir.y > -0.05){
    vec3 sunTrans = exp(-tauFromOD(opticalDepth(ro, sunDir, raySphere(ro, sunDir, R_ATMOS).y)));
    inscatter += sunDisc(rd, sunDir, sunTrans, sunDir.y);
  }

  // Pequeño "lift" nocturno (luz residual estrellada/zodiacal)
  inscatter += uNightLift * vec3(0.008, 0.012, 0.025) * max(0.0, rd.y * 0.5 + 0.5);

  gl_FragColor = vec4(inscatter, 1.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uRayleigh: { value: state.rayleighStrength },
        uMie: { value: state.mieStrength },
        uMieG: { value: state.mieG },
        uTurbidity: { value: state.turbidity },
        uOzone: { value: state.ozoneStrength },
        uSunIntensity: { value: state.sunIntensity },
        uSunSize: { value: state.sunSize },
        uNightLift: { value: 1.0 },
        uGroundAlbedo: { value: new THREE.Color(0x0a0a0a) },
      },
    });

    const geom = new THREE.SphereGeometry(1, 48, 32);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.scale.setScalar(2000);
  }

  setSunDirection(dir: THREE.Vector3) {
    this.sunDir.copy(dir);
  }

  update() {
    this.material.uniforms.uRayleigh.value = state.rayleighStrength;
    this.material.uniforms.uMie.value = state.mieStrength;
    this.material.uniforms.uMieG.value = state.mieG;
    this.material.uniforms.uTurbidity.value = state.turbidity;
    this.material.uniforms.uOzone.value = state.ozoneStrength;
    this.material.uniforms.uSunIntensity.value = state.sunIntensity;
    this.material.uniforms.uSunSize.value = state.sunSize;
    // El "lift" nocturno se desvanece cuando el sol está alto
    const y = this.sunDir.y;
    this.material.uniforms.uNightLift.value = THREE.MathUtils.clamp(0.35 - y, 0, 1);
  }
}

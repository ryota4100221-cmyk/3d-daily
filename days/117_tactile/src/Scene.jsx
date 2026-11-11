import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import * as THREE from 'three'

// 立方体：面の向き（ビュー空間の法線）で3色を混ぜる。陰は付けず、黄の明度差だけで面を分ける
const cubeVert = /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  void main(){
    vN = normalize(normalMatrix * normal);
    vL = position;
    vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`
const cubeFrag = /* glsl */ `
  uniform vec3 cTop, cLeft, cLeftLo, cRight, cRightLo;
  uniform vec3 dTop, dLeft, dRight;
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  void main(){
    vec3 n = normalize(vN);
    float wt = pow(max(dot(n,dTop),0.0),3.0);
    float wl = pow(max(dot(n,dLeft),0.0),3.0);
    float wr = pow(max(dot(n,dRight),0.0),3.0);
    float s = wt+wl+wr+1e-4;
    // 面の中のグラデーション：画面の下ほど（ワールドの y が低いほど）左は白へ、右は橙へ
    float g = clamp(0.5 - vW.y*0.55, 0.0, 1.0);
    float gL = clamp(0.5 - vW.y*0.45 - vW.x*0.25, 0.0, 1.0);
    vec3 L = mix(cLeft, cLeftLo, gL);
    vec3 R = mix(cRight, cRightLo, g);
    vec3 col = (cTop*wt + L*wl + R*wr)/s;
    gl_FragColor = vec4(col,1.0);
  }`

// 拾い直し：画素ごとの乱数で円盤の中を N 回拾い、色は平均・不透明度は乱数のしきい値で粒にする
const quadVert = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`
const quadFrag = /* glsl */ `
  uniform sampler2D tCube; uniform vec2 res; uniform float radius; uniform float grain; uniform float dpr;
  varying vec2 vUv;
  float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
  void main(){
    vec2 px = gl_FragCoord.xy;
    vec4 acc = vec4(0.0);
    const int N = 14;
    float R = radius*dpr;
    for(int i=0;i<N;i++){
      float a = h(px + float(i)*17.31)*6.2831853;
      float r = sqrt(h(px*1.37 + float(i)*7.77))*R;
      vec4 c = texture2D(tCube, (px + vec2(cos(a),sin(a))*r)/res);
      acc += c;
    }
    acc /= float(N);
    vec3 col = acc.a>0.0 ? acc.rgb/acc.a : vec3(1.0);
    // ディザ：平滑な不透明度を締めてから、画素ごとの乱数のしきい値で 0/1 にする（内側から点が抜ける）
    float th = h(px*0.913+3.17);
    float aa = smoothstep(0.0, 1.0, acc.a);
    float d = step(th, pow(aa, 0.8));
    float alpha = mix(aa, d, grain);
    gl_FragColor = vec4(col, alpha);
  }`

const hx = (h) => new THREE.Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

export default function Scene({ pointer }) {
  const { gl, size, viewport } = useThree()
  const dpr = viewport.dpr
  const fbo = useMemo(() => new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType }), [])
  const cubeScene = useMemo(() => new THREE.Scene(), [])
  const cam = useMemo(() => new THREE.PerspectiveCamera(27.9, 1440 / 900, 0.1, 100), [])
  const cube = useRef()
  const parts = useMemo(() => {
    const geo = new RoundedBoxGeometry(2, 2, 2, 8, 0.16)
    const mat = new THREE.ShaderMaterial({
      vertexShader: cubeVert, fragmentShader: cubeFrag,
      uniforms: {
        cTop: { value: hx('#FFF43A') },
        cLeft: { value: hx('#FFFF52') },
        cLeftLo: { value: hx('#FFFF5C') },
        cRight: { value: hx('#F5D200') },
        cRightLo: { value: hx('#FBD800') },
        dTop: { value: new THREE.Vector3(0, 1, 0) },
        dLeft: { value: new THREE.Vector3(0, 0, 1) },
        dRight: { value: new THREE.Vector3(1, 0, 0) },
      },
    })
    const mesh = new THREE.Mesh(geo, mat)
    const pivot = new THREE.Group()
    pivot.add(mesh)
    cubeScene.add(pivot)
    const quadMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: quadFrag, transparent: true, depthTest: false, depthWrite: false,
      uniforms: { tCube: { value: fbo.texture }, res: { value: new THREE.Vector2(1, 1) }, radius: { value: 28 }, grain: { value: 0.3 }, dpr: { value: 1 } },
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat)
    quad.frustumCulled = false
    const quadScene = new THREE.Scene()
    quadScene.add(quad)
    return { mesh, pivot, mat, quadMat, quadScene }
  }, [cubeScene, fbo])

  const ortho = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])
  const tmp = useMemo(() => ({ m: new THREE.Matrix3(), v: new THREE.Vector3() }), [])
  const sm = useRef([0, 0])

  useFrame((state, dt) => {
    const W = Math.floor(size.width * dpr), H = Math.floor(size.height * dpr)
    if (fbo.width !== W || fbo.height !== H) fbo.setSize(W, H)
    parts.quadMat.uniforms.res.value.set(W, H)
    parts.quadMat.uniforms.dpr.value = dpr
    // 1440×900 の構図を基準に、画面の縦で合わせる
    cam.aspect = size.width / size.height
    cam.position.set(0, 0, 12)
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()

    const k = 1 - Math.exp(-dt * 2.5)
    sm.current[0] += (pointer.current[0] - sm.current[0]) * k
    sm.current[1] += (pointer.current[1] - sm.current[1]) * k
    const t = state.clock.elapsedTime
    const p = parts.pivot
    p.rotation.set(0.326 - sm.current[1] * 0.12 + Math.sin(t * 0.35) * 0.015, -0.847 + sm.current[0] * 0.2 + Math.sin(t * 0.27) * 0.02, -0.237, 'XYZ')
    p.position.set(0.004, -1.27, 0)
    p.scale.setScalar(1.73)
    // 面の色の向きは立方体の面に貼る（ビュー空間へ回す）
    cubeScene.updateMatrixWorld()
    cam.updateMatrixWorld()
    const nm = tmp.m.getNormalMatrix(new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, parts.mesh.matrixWorld))
    parts.mat.uniforms.dTop.value.set(0, 1, 0).applyMatrix3(nm).normalize()
    parts.mat.uniforms.dLeft.value.set(0, 0, 1).applyMatrix3(nm).normalize()
    parts.mat.uniforms.dRight.value.set(1, 0, 0).applyMatrix3(nm).normalize()

    gl.setRenderTarget(fbo)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(cubeScene, cam)
    gl.setRenderTarget(null)
    gl.clear()
    gl.render(parts.quadScene, ortho)
  }, 1)
  return null
}

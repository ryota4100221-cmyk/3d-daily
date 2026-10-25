# engine/bake — Blender Cycles で光を焼いて、three.js / R3F で「素材の色 × 焼いた光」として出す（2026-10-25・Bake Lab から汎用化）
#
#   Blender -b <scene.blend> -P engine/bake/bake.py -- <出力フォルダ> [samples=256] [density=400]
#   出力：<出力>/scene.glb（UV0=素材・UV1=ライトマップ）＋ <出力>/lm/<物体>_<状態>.png ＋ <出力>/lm/manifest.json
#   通しで回すなら bake.sh（圧縮・webp 化・夜のノイズ均しまで）
#
# その日の build.py（シーンを組むスクリプト・毎回白紙で書く）が付ける印は3つだけ：
#   1. scene['bake_states'] = 'day,night'          焼く光の状態（省略時 'main' の1状態）
#   2. ライト物体に obj['state'] = 'day' など。印の無いライトは全状態で点く（発光メッシュは切り替えない＝three 側で emissive を合わせる）
#      空（World の Background）は scene['world_<状態>'] = [r, g, b, 強さ] で状態ごとに差し替え（省略時はそのまま）
#   3. 細かい小物（葉・本・小さな器）に obj['bake'] = 'vertex'。それ以外のメッシュはライトマップ（UV1）に焼く。
#      obj['bake'] = 'skip' は焼かない（three 側で別のマテリアルを当てる物）
#
# 焼くのは DIFFUSE の direct+indirect（色なし）＝「その点に届いている光」だけ。three 側で 素材の色 × 焼いた光 にすると、
# Cycles の間接光・柔らかい影がそのまま Web で、ライト0灯・60fps で動く（M1 1440×900 で実測）。
#
# 符号化：v = sRGB_OETF(L / LMAX) を 8bit PNG に入れる。three 側は colorSpace=SRGB で読み、lightMapIntensity = LMAX·π
# （three は lightMap を irradiance として足し BRDF_Lambert で /π するため）。baked.js がこれを当てる。
#
# 🔴 踏んだ罠（Bake Lab 1〜4周目）
# - glTF から読み込んだ物体は rotation_mode='QUATERNION'＝rotation_euler を書いても無視される → build.py で rotation_mode='XYZ' にしてから回す
# - build.py が回した直後に保存した .blend は matrix_world が古い → ここで view_layer.update() してから使う
# - Boolean の後の materials.append だけだと空の枠が先頭に残り「マテリアル無し」＝焼き先なしで真っ黒（build.py 側で clear してから append）
# - 細かい物を smart_project にすると島が数 texel に潰れて汚れる → obj['bake']='vertex'（頂点に焼く）
# - 夜（暗い状態）の firefly → sample_clamp_indirect 4
# - export_image_format='WEBP' は一部画像で失敗し参照だけ残る（GLTFLoader が reading 'uri' で落ちる）→ AUTO で出して後で webp
import bpy, json, math, os, sys, time
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    raise SystemExit('usage: Blender -b scene.blend -P bake.py -- <出力フォルダ> [samples] [density]')
OUT = os.path.abspath(argv[0])
SAMPLES = int(argv[1]) if len(argv) > 1 else 256
DENSITY = int(argv[2]) if len(argv) > 2 else 400     # ライトマップの texel / m
LMAX = 6.0
LM = os.path.join(OUT, 'lm')
os.makedirs(LM, exist_ok=True)

scene = bpy.context.scene
bpy.context.view_layer.update()
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices:
    d.use = True
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 6
scene.cycles.sample_clamp_indirect = 4.0
bake = scene.render.bake
bake.use_pass_direct = True
bake.use_pass_indirect = True
bake.use_pass_color = False
bake.margin = 8
bake.margin_type = 'EXTEND'

STATES = [s.strip() for s in str(scene.get('bake_states', 'main')).split(',') if s.strip()]
meshes = [o for o in scene.objects if o.type == 'MESH' and o.get('bake') != 'skip' and not o.hide_render]
vx_objs = [o for o in meshes if o.get('bake') == 'vertex']
lm_objs = [o for o in meshes if o.get('bake') != 'vertex']
# 状態で切り替えるのはライト物体だけ（メッシュを hide_render すると、その物体自身の焼きと遮蔽が消える）。発光する傘などは three 側で emissive を状態に合わせる
emitters = [o for o in scene.objects if o.get('state') and o.type == 'LIGHT']


def area(o):
    s = o.matrix_world.to_scale()
    k = (abs(s.x) + abs(s.y) + abs(s.z)) / 3
    return sum(p.area for p in o.data.polygons) * k * k


def pow2(n):
    return int(2 ** round(math.log2(max(n, 1))))


# ---------- ライトマップ UV（UV1 = 'lm'） ----------
res = {}
for o in lm_objs:
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')     # 素材の UV が無い物にも UV0 を作る（UV1 だけだと glTF で TEXCOORD_0 になる）
    if 'lm' not in me.uv_layers:
        me.uv_layers.new(name='lm')
    me.uv_layers[0].active_render = True
    me.uv_layers.active = me.uv_layers['lm']
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, area_weight=1.0)
    bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    res[o.name] = max(256, min(2048, pow2(math.sqrt(area(o)) * DENSITY)))
print('RES', res)

world_bg = scene.world.node_tree.nodes.get('Background') if scene.world and scene.world.use_nodes else None


def set_state(state):
    for o in emitters:
        o.hide_render = o['state'] != state
    v = scene.get(f'world_{state}')
    if world_bg is not None and v is not None:
        world_bg.inputs['Color'].default_value = (v[0], v[1], v[2], 1)
        world_bg.inputs['Strength'].default_value = v[3]


def target_node(mat, img):
    nt = mat.node_tree
    n = nt.nodes.get('__lm__') or nt.nodes.new('ShaderNodeTexImage')
    n.name = '__lm__'
    n.image = img
    nt.nodes.active = n


def encode_save(img, path):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    L = np.clip(px[:, :3] / LMAX, 0, 1)
    v = np.where(L <= 0.0031308, L * 12.92, 1.055 * np.power(L, 1 / 2.4) - 0.055)
    out = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    out.colorspace_settings.name = 'Non-Color'
    o = np.ones((w * h, 4), dtype=np.float32)
    o[:, :3] = v
    out.pixels.foreach_set(o.ravel())
    out.filepath_raw = path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    return float(np.percentile(px[:, :3].max(axis=1), 99.5)), float(px[:, :3].max())


manifest = {'lmax': LMAX, 'samples': SAMPLES, 'density': DENSITY, 'states': STATES, 'objects': {}}
for o in meshes:
    for slot in o.material_slots:
        if slot.material and not slot.material.use_nodes:
            slot.material.use_nodes = True
for state in STATES:
    set_state(state)
    t0 = time.time()
    for o in lm_objs:
        r = res[o.name]
        img = bpy.data.images.new(f'{o.name}_{state}', r, r, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        if not o.material_slots:
            o.data.materials.append(bpy.data.materials.new(f'{o.name}_mat'))
            o.material_slots[0].material.use_nodes = True
        for slot in o.material_slots:
            if slot.material:
                target_node(slot.material, img)
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.data.uv_layers.active = o.data.uv_layers['lm']
        bake.target = 'IMAGE_TEXTURES'
        bpy.ops.object.bake(type='DIFFUSE', uv_layer='lm')
        p995, pmax = encode_save(img, os.path.join(LM, f'{o.name}_{state}.png'))
        manifest['objects'].setdefault(o.name, {'kind': 'map', 'res': r})[state] = {'p99_5': round(p995, 3), 'max': round(pmax, 3)}
        bpy.data.images.remove(img)
    for o in vx_objs:
        me = o.data
        an = f'_lm_{state}'
        if an not in me.color_attributes:
            me.color_attributes.new(an, 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes[an]
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bake.target = 'VERTEX_COLORS'
        bpy.ops.object.bake(type='DIFFUSE')
        v = np.empty(len(me.color_attributes[an].data) * 4, dtype=np.float32)
        me.color_attributes[an].data.foreach_get('color', v)
        v = v.reshape(-1, 4)[:, :3].max(axis=1)
        manifest['objects'].setdefault(o.name, {'kind': 'vertex'})[state] = {'p99_5': round(float(np.percentile(v, 99.5)), 3), 'max': round(float(v.max()), 3)}
    print('BAKED', state, f'{time.time() - t0:.0f}s')

# 焼き用ノードを外してから書き出す
for m in bpy.data.materials:
    if m.node_tree and '__lm__' in m.node_tree.nodes:
        m.node_tree.nodes.remove(m.node_tree.nodes['__lm__'])
for o in meshes:
    o.data.uv_layers.active = o.data.uv_layers[0]

# 光源の位置（three 座標 = Blender (x, z, -y)）。電球の芯やハローを three 側で置くため
manifest['lights'] = {o.name: {'state': o.get('state'), 'pos': [o.matrix_world.translation.x, o.matrix_world.translation.z, -o.matrix_world.translation.y]}
                      for o in scene.objects if o.type == 'LIGHT'}
with open(os.path.join(LM, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'scene.glb'), export_format='GLB', use_selection=True,
    export_texcoords=True, export_normals=True, export_materials='EXPORT',
    export_image_format='AUTO', export_attributes=True, export_vertex_color='NONE', export_cameras=False, export_lights=False, export_yup=True,
)
print('DONE', os.path.join(OUT, 'scene.glb'), 'states', STATES, 'map', len(lm_objs), 'vertex', len(vx_objs))

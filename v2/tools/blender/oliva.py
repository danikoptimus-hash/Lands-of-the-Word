"""Олива (Olea europaea) — модель 1 из списка владельца, эталон качества.

Запуск:  v2/tools/blender-local.sh run v2/tools/blender/oliva.py -- ПАПКА_ПОКАЗА [--export] [вариант …]
Варианты: 1 — взрослая раскидистая, 2 — молодая округлая, 3 — старая с перекрученным стволом. В ПАПКЕ_ПОКАЗА —
рендеры и файл .blend каждого варианта; с ключом --export все варианты с тремя уровнями подробности пишутся в
v2/assets/models/flora/oliva.glb (его читает игра) и в v2/models_src/oliva/oliva.blend.
Нужен атлас листвы v2/models_src/oliva/listva.png (его делают oliva_atlas.py и v2/tools/models/atlas.py).
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import treelib
from mathutils import Vector, noise

UP = treelib.UP
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SOURCE = os.path.join(ROOT, "models_src", "oliva")
CACHE = os.path.expanduser("~/.cache/zemli-slova/models")
HEIGHT = 6.0  # опорный рост модели, метры (FloraMeshes.REFERENCE)

# Форма варианта: высота развилки, наклон ствола, толщина у земли, доли кроны (сколько, на каком удалении и высоте,
# какого размера, насколько приплюснуты), витьё и борозды ствола, густота тела доли.
SHAPES = {
    1: dict(seed=11, fork=1.1, lean=0.3, base=0.42, lobes=7, ring=(1.6, 2.8), heights=(2.8, 4.7), size=(1.15, 1.6), flat=0.8, twist=1.4, flutes=0.2, top_lobe=True, body=8),
    2: dict(seed=23, fork=1.25, lean=0.12, base=0.24, lobes=5, ring=(0.8, 1.5), heights=(2.9, 4.5), size=(1.15, 1.5), flat=0.95, twist=0.6, flutes=0.1, top_lobe=True, body=9),
    3: dict(seed=37, fork=1.0, lean=0.42, base=0.56, lobes=6, ring=(1.9, 3.1), heights=(2.9, 4.8), size=(1.1, 1.5), flat=0.75, twist=1.9, flutes=0.28, top_lobe=False, body=6),
}


class Olive:
    def __init__(self, variant):
        self.variant = variant
        shape = self.shape = SHAPES[variant]
        rng = self.rng = random.Random(shape["seed"])
        # Ствол: от земли до развилки, с наклоном и изгибом.
        turn = rng.uniform(0.0, math.tau)
        away = Vector((math.cos(turn), math.sin(turn), 0.0))
        trunk = []
        for i in range(7):
            t = i / 6.0
            trunk.append(away * (shape["lean"] * t * t + math.sin(t * math.pi) * 0.12) + UP * (-0.35 + (shape["fork"] + 0.35) * t))
        # Доли кроны: клубы вокруг оси на разной высоте — между ними остаются просветы.
        lobes = []
        axis = trunk[-1] * Vector((1.0, 1.0, 0.0))
        start = rng.uniform(0.0, math.tau)
        for i in range(shape["lobes"]):
            angle = start + math.tau * i / shape["lobes"] + rng.uniform(-0.3, 0.3)
            reach = rng.uniform(*shape["ring"])
            size = rng.uniform(*shape["size"])
            lobes.append((axis + Vector((math.cos(angle) * reach, math.sin(angle) * reach, rng.uniform(*shape["heights"]))), Vector((size, size, size * shape["flat"]))))
        if shape["top_lobe"]:
            size = rng.uniform(*shape["size"])
            lobes.append((axis + Vector((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), shape["heights"][1] + 0.5)), Vector((size, size, size * shape["flat"]))))
        attractors = []
        for centre, radii in lobes:
            for _ in range(230):
                direction = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
                depth = rng.random() ** 0.45  # гуще к поверхности клуба: листва — снаружи
                attractors.append(centre + Vector((direction.x * radii.x, direction.y * radii.y, direction.z * radii.z)) * depth)
            # Путь главного сука: от развилки к доле — редкие точки, по ним сук доходит до своей доли.
            for n in range(1, 6):
                t = n / 6.0
                guide = trunk[-1].lerp(centre, t) + UP * 0.35 * math.sin(t * math.pi)
                attractors.append(guide + Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(-0.1, 0.1))))
        skeleton = self.skeleton = treelib.Skeleton(trunk)
        skeleton.grow(attractors, rng, step=0.27, influence=1.9, kill=0.42, tropism=(0.0, 0.0, 0.03), wobble=0.16)
        skeleton.finish(tip=0.006, power=2.25, base=shape["base"], fat=1.05)
        # Приведение к опорному росту: верх листвы — на высоте HEIGHT.
        factor = HEIGHT / (max(point.z for point in skeleton.points) + 0.55)
        skeleton.points = [point * factor for point in skeleton.points]
        skeleton.radii = [radius * factor for radius in skeleton.radii]
        self.lobes = [(centre * factor, radii * factor) for centre, radii in lobes]
        self.scale = factor
        self.phases = [rng.uniform(0.0, math.tau) for _ in range(4)]
        self.low = min(centre.z - radii.z for centre, radii in self.lobes)
        self.high = max(centre.z + radii.z for centre, radii in self.lobes)
        self.crown = sum((centre for centre, _ in self.lobes), Vector((0.0, 0.0, 0.0))) / len(self.lobes)
        self._plan_foliage()

    # ── ствол
    def trunk_profile(self, point, angle, along):
        """Ствол старой оливы: раструб корней у земли, борозды, закрученные вокруг оси, наплывы."""
        shape, phases = self.shape, self.phases
        height = max(point.z, 0.0)
        flare = 0.6 * math.exp(-height / 0.3)
        fade = math.exp(-height / (shape["fork"] * 1.2))
        wind = angle + shape["twist"] * height
        flutes = shape["flutes"] * (0.5 + fade) * (math.cos(5.0 * wind + phases[0]) * 0.6 + math.cos(3.0 * wind + phases[1]) * 0.4)
        roots = 0.35 * math.exp(-height / 0.22) * max(math.cos(5.0 * wind + phases[0]), 0.0)
        burl = 0.1 * noise.noise(point * 2.3 + Vector((phases[2], 0.0, 0.0)))
        return 1.0 + flare + flutes + roots + burl

    def limb_profile(self, point, angle, along):
        return 1.0 + 0.08 * math.cos(3.0 * angle + self.phases[3] + along * 1.5) + 0.08 * noise.noise(point * 3.1)

    # ── листва
    def _lobe(self, place):
        return min(self.lobes, key=lambda lobe: ((place - lobe[0]).x / lobe[1].x) ** 2 + ((place - lobe[0]).y / lobe[1].y) ** 2 + ((place - lobe[0]).z / lobe[1].z) ** 2)

    def _shade(self, place, depth):
        share = min(max((place.z - self.low) / max(self.high - self.low, 1.0e-6), 0.0), 1.0)
        return min(max((0.42 + 0.58 * depth / 1.1) * (0.62 + 0.38 * share), 0.3), 1.0)

    def _plan_foliage(self):
        """Где стоят ветви листвы: на концах и вдоль тонких ветвей и по наружной поверхности долей."""
        rng, skeleton = self.rng, self.skeleton
        spots = []
        for chain, order in skeleton.chains:
            for n, index in enumerate(chain):
                if skeleton.radii[index] > 0.02 * self.scale:
                    continue
                tip = not skeleton.children[index]
                if not tip and n % 2 != 0:
                    continue
                parent = skeleton.parents[index]
                heading = (skeleton.points[index] - skeleton.points[parent]).normalized() if parent >= 0 else UP
                spots.append((skeleton.points[index], heading))
        # Оболочка долей: ветви по наружной поверхности каждого клуба — крона сомкнута и круглится.
        for centre, radii in self.lobes:
            for n in range(26):
                out = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0.25, 1))).normalized()
                spots.append((centre + Vector((out.x * radii.x, out.y * radii.y, out.z * radii.z)) * rng.uniform(0.72, 0.95), out))
        rng.shuffle(spots)
        self.sprays = []  # ветви: место, наружу, направление, размер, затенение
        for place, heading in spots[:640]:
            centre, radii = self._lobe(place)
            out = Vector(((place - centre).x / radii.x, (place - centre).y / radii.y, (place - centre).z / radii.z))
            outward = out.normalized() if out.length > 1.0e-6 else UP
            droop = -0.35 if out.z < 0.1 else 0.05  # снизу доли ветви поникают
            # Ветвь ложится вдоль поверхности доли (как черепица), а не торчит из неё: снаружи видна её плоскость.
            around = outward.cross(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))))
            around = around.normalized() if around.length > 1.0e-4 else outward.cross(UP).normalized()
            direction = (around * 0.6 + outward * 0.35 + heading * 0.25 + UP * droop).normalized()
            self.sprays.append(dict(place=place, outward=outward, direction=direction, scale=rng.uniform(0.7, 1.05), shade=self._shade(place, min(out.length, 1.3)),
                                    cell=rng.randrange(4), bend=rng.uniform(-0.12, 0.05)))
        self.bodies = []  # тело доли: большие охапки изнутри наружу — мягкая плотная масса под отдельными ветвями
        for centre, radii in self.lobes:
            for n in range(self.shape["body"]):
                out = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0.35, 1))).normalized()
                base = centre + Vector((out.x * radii.x, out.y * radii.y, out.z * radii.z)) * rng.uniform(0.1, 0.35)
                reference = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 0.3)))
                side = out.cross(reference)
                side = side.normalized() if side.length > 1.0e-4 else out.cross(UP).normalized()
                share = min(max((base.z - self.low) / max(self.high - self.low, 1.0e-6), 0.0), 1.0)
                self.bodies.append(dict(base=base, out=out, side=side, scale=rng.uniform(0.75, 1.0) * radii.x / 1.5, shade=0.5 * (0.62 + 0.38 * share), cell=rng.randrange(2)))

    def _normal(self, place, outward):
        return (outward * 0.7 + (place - self.crown).normalized() * 0.2 + UP * 0.45).normalized()

    def build_level(self, level, table, materials, collection=None):
        """Сетка уровня подробности: 0 — полная, 1 — упрощённая, 2 — самая простая."""
        rng = random.Random(self.shape["seed"] * 10 + level)
        builder = treelib.MeshBuilder()
        branches = treelib.build_wood(builder, self.skeleton, rng, level, self.trunk_profile, self.limb_profile, scale=1.0)
        wood = builder.triangles()
        small = [table["cells"]["vetv_%d" % i] for i in (1, 2, 3, 4)]
        big = [table["cells"]["ohapka_%d" % i] for i in (1, 2)]
        rect = lambda cell: (cell["u0"], cell["v0"], cell["u1"], cell["v1"])
        # Полная листва: по ней же строится оболочка кроны для упрощённых уровней.
        full = treelib.MeshBuilder() if level > 0 else builder
        for body in self.bodies:
            cell = big[body["cell"]]
            normal = (body["out"] * 0.75 + UP * 0.45).normalized()
            full.card(body["base"], body["out"] * cell["height"] * body["scale"], body["side"] * cell["width"] * body["scale"] * 0.5, rect(cell),
                      [normal, normal, normal], [0.5, 0.75, 1.0], body["shade"], 1, segments=1)
        for spray in self.sprays:
            cell = small[spray["cell"]]
            direction, outward, place = spray["direction"], spray["outward"], spray["place"]
            length = cell["height"] * spray["scale"]
            half = cell["width"] * spray["scale"] * 0.5
            normal = self._normal(place, outward)
            tip_normal = (normal + direction * 0.35).normalized()
            for cross in range(2):
                # Первая карточка смотрит наружу доли, вторая — поперёк неё: объём с любой стороны.
                side = outward.cross(direction)
                side = side.normalized() if side.length > 1.0e-4 else direction.cross(UP).normalized()
                if cross == 1:
                    side = direction.cross(side).normalized()
                full.card(place - direction * length * 0.08, direction * length, side * half, rect(cell), [normal, normal, tip_normal], [0.55, 0.8, 1.0],
                          spray["shade"], 1, bend=spray["bend"], segments=2 if cross == 0 else 1)
        if level > 0:
            hull = treelib.Hull(full.vertices)
            places = [spray["place"] for spray in self.sprays]
            groups = treelib.kmeans(places, 34 if level == 1 else 9, rng)
            for group in groups:
                centre = sum((places[i] for i in group), Vector((0.0, 0.0, 0.0))) / len(group)
                outward = sum((self.sprays[i]["outward"] for i in group), Vector((0.0, 0.0, 0.0)))
                outward = outward.normalized() if outward.length > 1.0e-4 else UP
                spread = max(max((places[i] - centre).length for i in group), 0.35)
                # Охапка плотнее отдельных ветвей и на свету выходит темнее — затенение чуть слабее, тон уровней сходится.
                shade = min(sum(self.sprays[i]["shade"] for i in group) / len(group) * 1.12, 1.0)
                cell = big[rng.randrange(2)]
                size = (spread + 0.45) * (1.25 if level == 1 else 1.35)
                normal = self._normal(centre, outward)
                # Охапка стоит на поверхности кроны лицом наружу (низ картинки — к середине кроны снизу), вторая — поперёк.
                rise = (UP - outward * UP.dot(outward))
                rise = rise.normalized() if rise.length > 0.2 else outward.cross(Vector((1.0, 0.0, 0.0))).normalized()
                for cross in range(2):
                    along = (rise if cross == 0 else (outward * 0.8 + rise * 0.6).normalized()) * size * 1.5
                    side = (outward.cross(rise) if cross == 0 else rise.cross(outward).cross(along.normalized())).normalized() * size * cell["width"] / cell["height"] * 0.75
                    base, along, side = hull.fit(centre - along * 0.5, along, side)
                    builder.card(base, along, side, rect(cell), [normal, normal, normal], [0.6, 0.8, 1.0], shade, 1, segments=1)
        name = "oliva_%02d_LOD%d" % (self.variant, level)
        obj = builder.to_object(name, materials, collection)
        print("%s: ветвей %d, треугольников %d (кора %d, листва %d)" % (name, branches, builder.triangles(), wood, builder.triangles() - wood))
        return obj


def materials():
    bark = treelib.bark_material("kora", os.path.join(SOURCE, "kora.jpg"), os.path.join(SOURCE, "kora_n.jpg"))
    leaves = treelib.leaf_material("listva", os.path.join(SOURCE, "listva.png"), os.path.join(SOURCE, "listva_n.png"))
    return [bark, leaves]


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:]
    folder = arguments[0]
    export = "--export" in arguments
    variants = [int(a) for a in arguments[1:] if not a.startswith("--")] or [1]
    os.makedirs(folder, exist_ok=True)
    table = json.load(open(os.path.join(SOURCE, "listva.json"), encoding="utf-8"))
    if export:
        scene = treelib.reset_scene()
        shared = materials()
        objects = []
        for variant in (1, 2, 3):
            tree = Olive(variant)
            for level in range(3):
                objects.append(tree.build_level(level, table, shared))
        treelib.export_glb(os.path.join(ROOT, "assets", "models", "flora", "oliva.glb"), objects)
        # В файле .blend варианты стоят в ряд, уровни — друг за другом: удобно смотреть в Blender.
        for index, obj in enumerate(objects):
            obj.location = ((index // 3) * 12.0, (index % 3) * 12.0, 0.0)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE, "oliva.blend"), compress=True)
        return
    for variant in variants:
        scene = treelib.reset_scene()
        tree = Olive(variant)
        tree.build_level(0, table, materials())
        treelib.beauty_scene(scene)
        treelib.look_at(scene, (0.0, 0.0, 2.9), 17.0, 25.0, 9.0, lens=50.0)
        treelib.render_to(scene, os.path.join(folder, "oliva_%d.png" % variant), 1100, 900, samples=40, transparent=False, standard=False)
        # Вид «как в игре»: сверху под 40°, издали.
        treelib.look_at(scene, (0.0, 0.0, 2.6), 30.0, 205.0, 40.0, lens=50.0)
        treelib.render_to(scene, os.path.join(folder, "oliva_%d_sverhu.png" % variant), 900, 700, samples=32, transparent=False, standard=False)


main()

"""Общая часть скриптов моделей деревьев для Blender (версия 2, решение владельца 13.11: модели — в Blender).

Как строится дерево:
  1. Листва — с фотографий: вырезанные ветки (v2/tools/models/key.py) собираются в объёмные ветви (десятки веток
     на побеге, под разными углами), ветви снимаются без света в клетки атласа: цвет, прозрачность, нормали и
     затенение внутри ветви. Карточка листвы в игре — это снимок настоящей объёмной ветви, а не рисунок.
  2. Скелет — «колонизацией пространства»: в объёме кроны (несколько долей-клубов) рассыпаются точки притяжения,
     ветви растут к ним от ствола и ветвятся сами. Толщина — по правилу труб (сечение родителя — сумма сечений детей).
  3. Ствол и главные сучья — одна сглаженная сетка с наплывами и витьём; на неё запекается кора (цвет, нормали,
     затенение) с подробной сетки. Тонкие ветви — трубки.
  4. Уровни подробности — из той же модели; нормали листвы — «от доли кроны наружу», в цвете вершин — гибкость
     для ветра (красный) и затенение в глубине кроны (зелёный), как требует v2/assets/models/README.md.

Запускается только внутри Blender: v2/tools/blender-local.sh run v2/tools/blender/<вид>.py
"""
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree, noise

UP = Vector((0.0, 0.0, 1.0))


# ───────────────────────── сцена и рендер ─────────────────────────

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.unit_settings.system = "METRIC"
    scene.render.threads_mode = "AUTO"
    return scene


def load_image(path, data=False):
    image = bpy.data.images.load(os.path.abspath(path), check_existing=True)
    if data:
        image.colorspace_settings.name = "Non-Color"
    return image


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_object(name, mesh, collection=None):
    return link(bpy.data.objects.new(name, mesh), collection)


def mesh_from(name, vertices, faces, uvs=None):
    """Сетка из списков: vertices — точки, faces — наборы номеров, uvs — координаты текстуры по углам граней."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in vertices], [], faces)
    if uvs is not None:
        layer = mesh.uv_layers.new(name="UVMap")
        for loop, uv in zip(layer.data, uvs):
            loop.uv = uv
    mesh.update()
    return mesh


def pass_material(name, image, kind):
    """Материал для съёмки ветвей в атлас. kind: 'color' — цвет без света, 'normal' — нормаль к камере цветом,
    'shade' — белая матовая поверхность (под ровным светом неба даёт затенение внутри ветви)."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    links.new(mix.outputs[0], out.inputs[0])
    links.new(clear.outputs[0], mix.inputs[1])
    if image is not None:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.extension = "CLIP"
        # Край режется: полупрозрачные точки фотографии не должны давать «дым» вокруг листьев.
        cut = nodes.new("ShaderNodeMath")
        cut.operation = "GREATER_THAN"
        cut.inputs[1].default_value = 0.5
        links.new(texture.outputs["Alpha"], cut.inputs[0])
        links.new(cut.outputs[0], mix.inputs[0])
    else:
        texture = None
        mix.inputs[0].default_value = 1.0
    if kind == "color":
        shader = nodes.new("ShaderNodeEmission")
        if texture is not None:
            links.new(texture.outputs["Color"], shader.inputs["Color"])
        else:
            shader.inputs["Color"].default_value = (0.2, 0.16, 0.12, 1.0)
    elif kind == "normal":
        shader = nodes.new("ShaderNodeEmission")
        geometry = nodes.new("ShaderNodeNewGeometry")
        # Карточка двусторонняя: с изнанки нормаль разворачивается к камере.
        flip = nodes.new("ShaderNodeVectorMath")
        flip.operation = "SCALE"
        sign = nodes.new("ShaderNodeMapRange")
        sign.inputs[1].default_value = 0.0
        sign.inputs[2].default_value = 1.0
        sign.inputs[3].default_value = 1.0
        sign.inputs[4].default_value = -1.0
        links.new(geometry.outputs["Backfacing"], sign.inputs[0])
        links.new(geometry.outputs["Normal"], flip.inputs[0])
        links.new(sign.outputs[0], flip.inputs["Scale"])
        to_camera = nodes.new("ShaderNodeVectorTransform")
        to_camera.vector_type = "NORMAL"
        to_camera.convert_from = "WORLD"
        to_camera.convert_to = "CAMERA"
        links.new(flip.outputs[0], to_camera.inputs[0])
        # В пространстве камеры Blender ось взгляда — +Z «от камеры»: к зрителю нормаль смотрит в −Z.
        fix = nodes.new("ShaderNodeVectorMath")
        fix.operation = "MULTIPLY"
        fix.inputs[1].default_value = (0.5, 0.5, -0.5)
        links.new(to_camera.outputs[0], fix.inputs[0])
        half = nodes.new("ShaderNodeVectorMath")
        half.operation = "ADD"
        half.inputs[1].default_value = (0.5, 0.5, 0.5)
        links.new(fix.outputs[0], half.inputs[0])
        links.new(half.outputs[0], shader.inputs["Color"])
    else:
        shader = nodes.new("ShaderNodeBsdfDiffuse")
        shader.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1.0)
    links.new(shader.outputs[0], mix.inputs[2])
    return material


def ortho_camera(scene, centre, size, depth=20.0):
    """Камера без перспективы: смотрит вдоль −Y на плоскость XZ (ветвь лежит в ней стеблем вниз)."""
    data = bpy.data.cameras.new("kamera")
    data.type = "ORTHO"
    data.ortho_scale = size
    data.clip_start = 0.01
    data.clip_end = depth * 2.0
    camera = link(bpy.data.objects.new("kamera", data))
    camera.location = (centre[0], centre[1] - depth, centre[2])
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    scene.camera = camera
    return camera


def render_to(scene, path, width, height, samples=24, transparent=True, standard=True):
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 4
    scene.cycles.transparent_max_bounces = 48
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    if standard:
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)


# ───────────────────────── ветви из фотографий веток ─────────────────────────

class Sprig:
    """Фотография одной ветки: текстура и её пропорции."""

    def __init__(self, path, length):
        self.image = load_image(path)
        self.length = length  # настоящая длина ветки, метры
        self.width = length * self.image.size[0] / self.image.size[1]
        self.materials = {kind: pass_material("vetka_%s_%s" % (os.path.basename(path), kind), self.image, kind) for kind in ("color", "normal", "shade")}


def sprig_card(sprig, rng, segments=4):
    """Карточка ветки: полоса вдоль +Z от основания, слегка изогнутая и «лодочкой» — не плоский лист бумаги."""
    vertices, faces, uvs = [], [], []
    bend = rng.uniform(-0.35, 0.35)
    cup = rng.uniform(0.05, 0.25)
    for i in range(segments + 1):
        t = i / segments
        z = sprig.length * t
        y = sprig.length * bend * t * t
        for side, u in ((-0.5, 0.0), (0.0, 0.5), (0.5, 1.0)):
            vertices.append((side * sprig.width, y + abs(side) * sprig.width * cup, z))
    for i in range(segments):
        for k in range(2):
            a = i * 3 + k
            faces.append((a, a + 1, a + 4, a + 3))
            u0, u1 = k * 0.5, k * 0.5 + 0.5
            v0, v1 = i / segments, (i + 1) / segments
            uvs += [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return mesh_from("vetka", vertices, faces, uvs)


def build_branchlet(sprigs, rng, length, count, side_shoots, collection, spread=(35.0, 60.0), droop=0.15):
    """Ветвь: побег вдоль +Z с ветками-фотографиями попарно накрест и боковыми побегами. Возвращает объекты."""
    objects = []

    def shoot(origin, direction, reach, pairs, depth):
        direction = direction.normalized()
        points = [origin.copy()]
        heading = direction.copy()
        steps = 8
        for i in range(steps):
            heading = (heading + Vector((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.0)) - UP * droop * 0.04 * (i + 1) * (1.0 if depth else 0.3)).normalized()
            points.append(points[-1] + heading * reach / steps)
        # Стебель — тонкая трубка в четыре грани.
        vertices, faces = [], []
        for i, point in enumerate(points):
            radius = (0.004 if depth == 0 else 0.0025) * (1.0 - 0.6 * i / steps)
            for k in range(4):
                angle = math.tau * k / 4
                vertices.append(point + Vector((math.cos(angle) * radius, math.sin(angle) * radius, 0.0)))
        for i in range(steps):
            for k in range(4):
                a, b = i * 4 + k, i * 4 + (k + 1) % 4
                faces.append((a, b, b + 4, a + 4))
        stem = new_object("stebel", mesh_from("stebel", vertices, faces), collection)
        stem["kind"] = "stem"
        objects.append(stem)
        roll = rng.uniform(0.0, math.tau)
        for pair in range(pairs):
            t = (pair + 0.5) / pairs
            at = points[0].lerp(points[-1], t) if False else points[min(int(t * steps), steps - 1)].lerp(points[min(int(t * steps) + 1, steps)], t * steps - int(t * steps))
            along = (points[min(int(t * steps) + 1, steps)] - points[min(int(t * steps), steps - 1)]).normalized()
            roll += math.radians(90.0) + rng.uniform(-0.4, 0.4)
            for half in range(2):
                sprig = sprigs[rng.randrange(len(sprigs))]
                card = new_object("vetka", sprig_card(sprig, rng), collection)
                card["sprig"] = sprigs.index(sprig)
                tilt = math.radians(rng.uniform(*spread)) * (1.0 - 0.45 * t)  # к вершине ветки прижаты к побегу
                turn = roll + math.pi * half
                # Сначала наклон от побега, потом поворот вокруг побега, потом — побег в своё направление.
                local = Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Rotation(rng.uniform(-1.2, 1.2), 4, "Z")
                frame = along.to_track_quat("Z", "Y").to_matrix().to_4x4()
                scale = rng.uniform(1.15, 1.6) * (1.0 - 0.3 * t)
                card.matrix_world = Matrix.Translation(at) @ frame @ local @ Matrix.Scale(scale, 4)
                objects.append(card)
        return points

    main = shoot(Vector((0.0, 0.0, 0.0)), UP, length, count, 0)
    for i in range(side_shoots):
        t = rng.uniform(0.15, 0.7)
        at = main[int(t * 8)]
        angle = rng.uniform(0.0, math.tau)
        out = Vector((math.cos(angle), math.sin(angle), rng.uniform(0.1, 0.8)))
        shoot(at, out, length * rng.uniform(0.4, 0.62) * (1.0 - 0.3 * t), max(int(count * 0.45), 3), 1)
    return objects


def set_pass(objects, sprigs, kind, stem_materials):
    for obj in objects:
        obj.data.materials.clear()
        if obj.get("kind") == "stem":
            obj.data.materials.append(stem_materials[kind])
        else:
            obj.data.materials.append(sprigs[obj["sprig"]].materials[kind])


def render_cells(scene, cells, sprigs, folder, pixels_per_metre, supersample=2):
    """Снять ветви в отдельные картинки: для каждой — цвет и нормали. cells — (имя, объекты, ширина, высота)
    в метрах; ветвь стоит основанием в начале координат своей клетки, растёт вдоль +Z. Возвращает описание клеток."""
    os.makedirs(folder, exist_ok=True)
    stem_materials = {kind: pass_material("stebel_" + kind, None, kind) for kind in ("color", "normal", "shade")}
    world = bpy.data.worlds.new("nebo")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    result = []
    for name, objects, wide, tall, centre in cells:
        for other in cells:
            for obj in other[1]:
                obj.hide_render = other[0] != name
        camera = ortho_camera(scene, centre, max(wide, tall))
        width = int(round(wide * pixels_per_metre)) * supersample
        height = int(round(tall * pixels_per_metre)) * supersample
        camera.data.sensor_fit = "HORIZONTAL" if wide >= tall else "VERTICAL"
        for kind in ("color", "normal"):
            set_pass(objects, sprigs, kind, stem_materials)
            render_to(scene, os.path.join(folder, "%s_%s.png" % (name, kind)), width, height, samples=16)
        bpy.data.objects.remove(camera)
        result.append({"name": name, "width": wide, "height": tall})
    return result


# ───────────────────────── скелет: колонизация пространства ─────────────────────────

class Skeleton:
    """Скелет дерева: узлы (точка, родитель), толщина по правилу труб, ветви-цепочки."""

    def __init__(self, trunk):
        self.points = [Vector(p) for p in trunk]
        self.parents = [-1] + list(range(len(trunk) - 1))
        self.radii = []
        self.chains = []  # (номера узлов от основания ветви, порядок)

    def grow(self, attractors, rng, step=0.3, influence=2.2, kill=0.45, tropism=(0.0, 0.0, 0.02), wobble=0.12, rounds=120):
        """Ветви растут к точкам притяжения: каждая точка тянет ближайший узел; узел даёт побег в среднюю сторону
        своих точек. Точка, до которой дотянулись, гаснет."""
        attractors = [Vector(a) for a in attractors]
        pull = Vector(tropism)
        for _ in range(rounds):
            tree = kdtree.KDTree(len(self.points))
            for index, point in enumerate(self.points):
                tree.insert(point, index)
            tree.balance()
            wants = {}
            alive = []
            for target in attractors:
                _, index, distance = tree.find(target)
                if distance < kill:
                    continue
                alive.append(target)
                if distance < influence:
                    wants[index] = wants.get(index, Vector((0.0, 0.0, 0.0))) + (target - self.points[index]).normalized()
            attractors = alive
            if not wants:
                if not attractors:
                    break
                # Ни одна точка не достаёт до дерева: ближайший к точкам узел тянется к ближайшей из них.
                best = None
                for target in attractors[::max(len(attractors) // 60, 1)]:
                    _, index, distance = tree.find(target)
                    if best is None or distance < best[0]:
                        best = (distance, index, target)
                wants[best[1]] = (best[2] - self.points[best[1]]).normalized()
            grown = 0
            fresh = []
            for index, direction in wants.items():
                if direction.length < 1.0e-6:
                    continue
                heading = (direction.normalized() + pull + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * wobble).normalized()
                point = self.points[index] + heading * step
                _, _, near = tree.find(point)
                if near < step * 0.55 or any((point - other).length < step * 0.55 for other in fresh):
                    continue
                fresh.append(point)
                self.points.append(point)
                self.parents.append(index)
                grown += 1
            if grown == 0:
                break
        return self

    def finish(self, tip=0.006, power=2.3, base=0.3, fat=1.3):
        """Толщина: сечение родителя — сумма сечений детей (правило труб); потом всё приводится к толщине ствола
        base у земли, толстые части — ещё толще (fat > 1: у старых деревьев ствол массивнее «трубного»)."""
        count = len(self.points)
        children = [[] for _ in range(count)]
        for index, parent in enumerate(self.parents):
            if parent >= 0:
                children[parent].append(index)
        radii = [0.0] * count
        for index in range(count - 1, -1, -1):
            if not children[index]:
                radii[index] = tip
            else:
                radii[index] = sum(radii[child] ** power for child in children[index]) ** (1.0 / power)
        top = max(radii[0], tip * 1.01)
        # Концы остаются тонкими (tip), ствол у земли — base; между ними — по «трубной» толщине в степени fat.
        self.radii = [tip + (base - tip) * (max(r - tip, 0.0) / (top - tip)) ** fat for r in radii]
        self.children = children
        # Ветви-цепочки: от узла — по самому толстому ребёнку; остальные дети начинают свои ветви.
        self.chains = []
        stack = [(0, 0, None)]
        while stack:
            start, order, parent = stack.pop()
            chain = [start] if parent is None else [parent, start]
            node = start
            while children[node]:
                ordered = sorted(children[node], key=lambda child: -radii[child])
                for other in ordered[1:]:
                    stack.append((other, order + 1, node))
                node = ordered[0]
                chain.append(node)
            self.chains.append((chain, order))
        return self

    def tips(self):
        return [index for index in range(len(self.points)) if not self.children[index]]


def smooth_chain(points, radii, spacing, rng, gnarl=0.0):
    """Ветвь плавной линией: сгладить ломаную (рост шёл равными шагами) и пересчитать точки через spacing метров."""
    if len(points) < 3:
        return list(points), list(radii)
    smooth = [points[0]] + [(points[i - 1] + points[i] * 2.0 + points[i + 1]) * 0.25 for i in range(1, len(points) - 1)] + [points[-1]]
    lengths = [0.0]
    for i in range(1, len(smooth)):
        lengths.append(lengths[-1] + (smooth[i] - smooth[i - 1]).length)
    total = lengths[-1]
    count = max(int(round(total / spacing)), 2)
    out_points, out_radii = [], []
    at = 0
    for n in range(count + 1):
        s = total * n / count
        while at < len(lengths) - 2 and lengths[at + 1] < s:
            at += 1
        span = max(lengths[at + 1] - lengths[at], 1.0e-9)
        t = min(max((s - lengths[at]) / span, 0.0), 1.0)
        point = smooth[at].lerp(smooth[at + 1], t)
        if gnarl > 0.0 and 0 < n < count:
            point = point + noise.noise_vector(point * 1.7 + Vector((rng.uniform(0, 9), 0, 0))) * gnarl
        out_points.append(point)
        out_radii.append(radii[at] + (radii[at + 1] - radii[at]) * t)
    return out_points, out_radii


class MeshBuilder:
    """Копит сетку с координатами текстуры, цветом вершин (гибкость, затенение) и своими нормалями."""

    def __init__(self):
        self.vertices, self.normals, self.colors = [], [], []
        self.faces, self.uvs, self.materials = [], [], []

    def tube(self, points, radii, sides, flex, material, u_repeat=1, v_scale=1.0, profile=None, shade=1.0):
        """Трубка по линии. profile(point, angle, along) — множитель радиуса (наплывы, борозды ствола)."""
        first = len(self.vertices)
        tangent = (points[1] - points[0]).normalized()
        side = tangent.cross(UP if abs(tangent.z) < 0.95 else Vector((1.0, 0.0, 0.0))).normalized()
        along = 0.0
        for i, point in enumerate(points):
            if i > 0:
                along += (point - points[i - 1]).length
            heading = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            side = (side - heading * side.dot(heading)).normalized()
            other = heading.cross(side)
            for k in range(sides + 1):
                angle = math.tau * k / sides
                out = side * math.cos(angle) + other * math.sin(angle)
                grow = profile(point, angle, along) if profile else 1.0
                self.vertices.append(point + out * radii[i] * grow)
                self.normals.append(out)
                self.colors.append((flex[i], shade if not isinstance(shade, list) else shade[i], 0.0, 1.0))
        for i in range(len(points) - 1):
            v0 = self._along(points, i) * v_scale
            v1 = self._along(points, i + 1) * v_scale
            for k in range(sides):
                a = first + i * (sides + 1) + k
                b = a + sides + 1
                self.faces.append((a, a + 1, b + 1, b))
                u0, u1 = k / sides * u_repeat, (k + 1) / sides * u_repeat
                self.uvs += [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                self.materials.append(material)

    @staticmethod
    def _along(points, index):
        return sum((points[i] - points[i - 1]).length for i in range(1, index + 1))

    def card(self, base, along, side, cell, normals, flexes, shade, material, bend=0.0, segments=2):
        """Карточка листвы от основания ветви к концу: одна плоскость или две половины по длине (излом — лёгкий
        изгиб). cell — клетка атласа (u0, v0, u1, v1 в координатах картинки, v вниз); normals и flexes — три
        значения: у основания, в середине, на конце."""
        first = len(self.vertices)
        u0, v0, u1, v1 = cell
        sag = side.cross(along).normalized() * along.length * bend
        if segments == 2:
            rows = [(0.0, base, 0), (0.5, base + along * 0.5 + sag, 1), (1.0, base + along, 2)]
        else:
            rows = [(0.0, base, 0), (1.0, base + along, 2)]
        for t, centre, at in rows:
            for sign in (-1.0, 1.0):
                self.vertices.append(centre + side * sign)
                self.normals.append(normals[at])
                self.colors.append((flexes[at], shade, 0.0, 1.0))
        for n in range(len(rows) - 1):
            a = first + n * 2
            self.faces.append((a, a + 1, a + 3, a + 2))
            # Низ картинки ветви (её основание) — у base: в картинке v растёт вниз, в Blender — вверх.
            t0, t1 = rows[n][0], rows[n + 1][0]
            w0 = 1.0 - (v1 + (v0 - v1) * t0)
            w1 = 1.0 - (v1 + (v0 - v1) * t1)
            self.uvs += [(u0, w0), (u1, w0), (u1, w1), (u0, w1)]
            self.materials.append(material)

    def triangles(self):
        return sum(len(face) - 2 for face in self.faces)

    def to_object(self, name, materials, collection=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in self.vertices], [], self.faces)
        layer = mesh.uv_layers.new(name="UVMap")
        for loop, uv in zip(layer.data, self.uvs):
            loop.uv = uv
        for material in materials:
            mesh.materials.append(material)
        for polygon, index in zip(mesh.polygons, self.materials):
            polygon.material_index = index
            polygon.use_smooth = True
        colors = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for index, color in enumerate(self.colors):
            colors.data[index].color = color
        mesh.color_attributes.active_color = colors
        mesh.color_attributes.render_color_index = 0
        mesh.update()
        mesh.normals_split_custom_set_from_vertices([tuple(Vector(n).normalized()) for n in self.normals])
        return new_object(name, mesh, collection)


# ───────────────────────── материалы модели ─────────────────────────

def bark_material(name, color_path, normal_path, rough_path=None, tint=(1.0, 1.0, 1.0)):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    color = nodes.new("ShaderNodeTexImage")
    color.image = load_image(color_path)
    if tint != (1.0, 1.0, 1.0):
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = (*tint, 1.0)
        links.new(color.outputs["Color"], mix.inputs["A"])
        links.new(mix.outputs["Result"], shader.inputs["Base Color"])
    else:
        links.new(color.outputs["Color"], shader.inputs["Base Color"])
    relief = nodes.new("ShaderNodeTexImage")
    relief.image = load_image(normal_path, data=True)
    bump = nodes.new("ShaderNodeNormalMap")
    bump.inputs["Strength"].default_value = 1.0
    links.new(relief.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    shader.inputs["Roughness"].default_value = 0.9
    return material


def leaf_material(name, color_path, normal_path):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    color = nodes.new("ShaderNodeTexImage")
    color.image = load_image(color_path)
    links.new(color.outputs["Color"], shader.inputs["Base Color"])
    links.new(color.outputs["Alpha"], shader.inputs["Alpha"])
    relief = nodes.new("ShaderNodeTexImage")
    relief.image = load_image(normal_path, data=True)
    bump = nodes.new("ShaderNodeNormalMap")
    bump.inputs["Strength"].default_value = 0.6
    links.new(relief.outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    shader.inputs["Roughness"].default_value = 0.55
    # Лист просвечивает: часть света проходит насквозь (для показа в Blender; в игре это делает шейдер листвы).
    out = nodes["Material Output"]
    through = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(color.outputs["Color"], through.inputs["Color"])
    blend = nodes.new("ShaderNodeMixShader")
    blend.inputs[0].default_value = 0.35
    links.new(shader.outputs[0], blend.inputs[1])
    links.new(through.outputs[0], blend.inputs[2])
    clear = nodes.new("ShaderNodeBsdfTransparent")
    cut = nodes.new("ShaderNodeMath")
    cut.operation = "GREATER_THAN"
    cut.inputs[1].default_value = 0.5
    links.new(color.outputs["Alpha"], cut.inputs[0])
    final = nodes.new("ShaderNodeMixShader")
    links.new(cut.outputs[0], final.inputs[0])
    links.new(clear.outputs[0], final.inputs[1])
    links.new(blend.outputs[0], final.inputs[2])
    links.new(final.outputs[0], out.inputs[0])
    material.use_backface_culling = False
    return material


# ───────────────────────── показ: рендер дерева ─────────────────────────

def beauty_scene(scene, sun_turn=35.0, sun_height=50.0):
    """Свет для показа: солнце и небо, земля цвета сухой травы."""
    world = bpy.data.worlds.new("nebo_pokaz")
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    sky = nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(sun_height)
    sky.sun_rotation = math.radians(sun_turn)
    sky.sun_intensity = 0.25
    links.new(sky.outputs["Color"], nodes["Background"].inputs["Color"])
    nodes["Background"].inputs["Strength"].default_value = 0.3
    scene.world = world
    light = bpy.data.lights.new("solntse", "SUN")
    light.energy = 3.2
    light.angle = math.radians(1.5)
    sun = link(bpy.data.objects.new("solntse", light))
    sun.rotation_euler = (math.radians(90.0 - sun_height), 0.0, math.radians(180.0 - sun_turn))
    ground = bpy.data.materials.new("zemlya")
    ground.use_nodes = True
    ground.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.165, 0.09, 1.0)
    ground.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    plane = mesh_from("zemlya", [(-200, -200, 0), (200, -200, 0), (200, 200, 0), (-200, 200, 0)], [(0, 1, 2, 3)])
    plane.materials.append(ground)
    new_object("zemlya", plane)
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "Filmic" if "Filmic" in [item.identifier for item in type(scene.view_settings).bl_rna.properties["view_transform"].enum_items] else "AgX"


def look_at(scene, target, distance, turn, pitch, lens=50.0):
    data = bpy.data.cameras.new("pokaz")
    data.lens = lens
    data.clip_end = 2000.0
    camera = link(bpy.data.objects.new("pokaz", data))
    direction = Vector((math.cos(math.radians(pitch)) * math.sin(math.radians(turn)), -math.cos(math.radians(pitch)) * math.cos(math.radians(turn)), math.sin(math.radians(pitch))))
    camera.location = Vector(target) + direction * distance
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    return camera


# ───────────────────────── уровни подробности и выгрузка ─────────────────────────

# Кора по уровням: (самая тонкая рисуемая ветвь у основания, метры; ступени «толщина → граней, шаг колец»)
WOOD_LEVELS = [
    (0.05, [(0.15, 12, 0.2), (0.09, 6, 0.5), (0.0, 4, 0.8)]),
    (0.11, [(0.2, 6, 0.6), (0.0, 4, 1.1)]),
    (0.2, [(0.25, 4, 1.2), (0.0, 3, 1.8)]),
]


def build_wood(builder, skeleton, rng, level, trunk_profile=None, limb_profile=None, material=0, scale=1.0):
    """Ствол и ветви уровня подробности: трубки по ветвям-цепочкам толще предела уровня. Возвращает число ветвей."""
    limit, steps = WOOD_LEVELS[level]
    limit *= scale
    drawn = 0
    for chain, order in skeleton.chains:
        points = [skeleton.points[i] for i in chain]
        radii = [skeleton.radii[i] for i in chain]
        if len(points) < 2 or radii[0] < limit:
            continue
        # Ветвь рисуется, пока не станет тоньше предела: дальше её прячет листва.
        keep = len(points)
        for i, radius in enumerate(radii):
            if radius < limit * 0.6 and i >= 2:
                keep = i + 1
                break
        points, radii = points[:keep], radii[:keep]
        thick = radii[0] / scale
        sides, spacing = next((s, d) for bound, s, d in steps if thick > bound)
        points, radii = smooth_chain(points, radii, spacing * scale, rng, gnarl=0.03 * scale if order else 0.0)
        if order > 0:
            radii[0] *= 1.25  # основание сука — в теле родителя и чуть толще: развилка без «воткнутой палки»
        count = len(points)
        flex = [min(0.05 * order + 0.3 * (i / (count - 1)) * (order + 0.3), 1.0) for i in range(count)]
        profile = trunk_profile if order == 0 else (limb_profile if thick > 0.05 else None)
        builder.tube(points, radii, sides, flex, material, u_repeat=max(round(thick * 9.0), 1), v_scale=0.6 / scale, profile=profile)
        drawn += 1
    return drawn


class Hull:
    """Оболочка кроны полной модели: по слоям высоты — середина и радиус листвы. В неё вписываются карточки
    упрощённых уровней: крона на любом расстоянии — того же размера и формы, что вблизи."""

    def __init__(self, points, slices=14):
        heights = sorted(point.z for point in points)
        self.low = heights[int(len(heights) * 0.005)]
        self.high = heights[min(int(len(heights) * 0.995), len(heights) - 1)]
        self.step = max((self.high - self.low) / slices, 1.0e-6)
        self.centres, self.radii = [], []
        for i in range(slices):
            inside = [p for p in points if self.low + i * self.step <= p.z < self.low + (i + 1) * self.step]
            if len(inside) < 4:
                self.centres.append(self.centres[-1] if self.centres else Vector((0.0, 0.0, 0.0)))
                self.radii.append(self.radii[-1] if self.radii else 0.3)
                continue
            centre = sum(inside, Vector((0.0, 0.0, 0.0))) / len(inside)
            distances = sorted(math.hypot(p.x - centre.x, p.y - centre.y) for p in inside)
            self.centres.append(centre)
            self.radii.append(distances[min(int(len(distances) * 0.96), len(distances) - 1)])

    def outside(self, point, slack=1.06):
        margin = 0.03 * (self.high - self.low)
        if point.z > self.high + margin or point.z < self.low - margin:
            return True
        i = min(max(int((point.z - self.low) / self.step), 0), len(self.radii) - 1)
        return math.hypot(point.x - self.centres[i].x, point.y - self.centres[i].y) > self.radii[i] * slack

    def fit(self, base, along, side, fill=0.82):
        """Вписать карточку в оболочку: сначала сужается, потом укорачивается. fill — доля карточки, занятая рисунком."""
        centre = base + along * 0.5
        for attempt in range(16):
            corners = [centre + along * 0.5 * a * fill + side * b * fill for a in (-1.0, 1.0) for b in (-1.0, 1.0)]
            if not any(self.outside(corner) for corner in corners):
                break
            side = side * 0.9
            if attempt % 2 == 1:
                along = along * 0.92
        return centre - along * 0.5, along, side


def kmeans(points, count, rng, rounds=12):
    """Группы точек (номера точек по группам): простое разбиение по ближайшему центру."""
    count = min(count, len(points))
    centres = [points[i].copy() for i in rng.sample(range(len(points)), count)]
    groups = []
    for _ in range(rounds):
        groups = [[] for _ in range(count)]
        for index, point in enumerate(points):
            best = min(range(count), key=lambda c: (point - centres[c]).length_squared)
            groups[best].append(index)
        for c in range(count):
            if groups[c]:
                centres[c] = sum((points[i] for i in groups[c]), Vector((0.0, 0.0, 0.0))) / len(groups[c])
    return [group for group in groups if group]


def export_glb(path, objects):
    """Выгрузить объекты в один файл glTF (.glb): нормали, цвет вершин, материалы с текстурами — как требует игра."""
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                              export_image_format="AUTO", export_cameras=False, export_lights=False, export_animations=False, export_extras=False)

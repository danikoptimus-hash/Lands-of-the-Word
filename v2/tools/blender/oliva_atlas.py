"""Олива: атлас листвы из фотографий веток (шаг 1). Запуск: v2/tools/blender-local.sh run v2/tools/blender/oliva_atlas.py -- ПАПКА"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import treelib
from mathutils import Matrix, Vector

folder = sys.argv[sys.argv.index("--") + 1]
root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
scene = treelib.reset_scene()
rng = random.Random(7)
# Ветка оливы на фотографии — около 18 см (лист оливы — 4–8 см).
sprigs = [treelib.Sprig(os.path.join(root, "models_src", "oliva", "vetka_%d.png" % i), rng.uniform(0.17, 0.2)) for i in (1, 2, 3, 4)]

cells = []
# Четыре ветви (побег 70–85 см, полсотни веток на каждой) — карточки полной модели.
for index in range(4):
    collection = bpy.data.collections.new("vetv_%d" % index)
    scene.collection.children.link(collection)
    objects = treelib.build_branchlet(sprigs, rng, rng.uniform(0.6, 0.75), 14, 10, collection, spread=(45.0, 78.0), droop=0.3)
    offset = Vector((index * 3.0, 0.0, 0.0))
    for obj in objects:
        obj.matrix_world = Matrix.Translation(offset) @ obj.matrix_world
    cells.append(("vetv_%d" % (index + 1), objects, 0.9, 1.0, (offset.x, 0.0, 0.42)))
# Две охапки (десяток ветвей веером, поперечник около 1,8 м) — карточки упрощённых уровней.
for index in range(2):
    collection = bpy.data.collections.new("ohapka_%d" % index)
    scene.collection.children.link(collection)
    objects = []
    offset = Vector((index * 4.0, 0.0, 6.0))
    for n in range(13):
        angle = math.tau * n / 13 + rng.uniform(-0.2, 0.2)
        lean = rng.uniform(0.15, 1.15)
        part = treelib.build_branchlet(sprigs, rng, rng.uniform(0.65, 0.85), 13, 7, collection, spread=(45.0, 78.0), droop=0.3)
        frame = Matrix.Rotation(angle, 4, "Z") @ Matrix.Rotation(lean, 4, "X")
        base = Vector((math.cos(angle) * 0.12, math.sin(angle) * 0.12, 0.0))
        for obj in part:
            obj.matrix_world = Matrix.Translation(offset + base) @ frame @ obj.matrix_world
        objects += part
    cells.append(("ohapka_%d" % (index + 1), objects, 1.9, 1.35, (offset.x, 0.0, offset.z + 0.42)))

treelib.render_cells(scene, cells, sprigs, folder, 500.0)
print("ГОТОВО: клеток", len(cells))

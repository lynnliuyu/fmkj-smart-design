"""Regression for legend HATCH transforms through actual INSERT expansion.

ezdxf 1.4.4 applied the stored pattern scale/angle twice. A small AR-SAND
legend could expand into millions of dots before the PDF backend ran.
"""
import unittest

import ezdxf
from ezdxf.math import Vec3


class HatchTransformTest(unittest.TestCase):
    def make_legend(self, scale=0.005, angle=0):
        doc = ezdxf.new()
        block = doc.blocks.new("legend")
        hatch = block.add_hatch()
        hatch.set_pattern_fill("AR-SAND", scale=scale, angle=angle)
        hatch.paths.add_polyline_path(
            [(0, 0), (4.5, 0), (4.5, 2.5), (0, 2.5)], is_closed=True
        )
        return doc, hatch

    def assert_pattern_transformed_once(self, source, transformed, matrix):
        self.assertEqual(len(source.pattern.lines), len(transformed.pattern.lines))
        for before, after in zip(source.pattern.lines, transformed.pattern.lines):
            expected_base = matrix.transform(Vec3(before.base_point))
            expected_offset = matrix.transform_direction(Vec3(before.offset))
            self.assertTrue(after.base_point.isclose(expected_base.vec2, abs_tol=1e-8))
            self.assertTrue(after.offset.isclose(expected_offset.vec2, abs_tol=1e-8))
            old_direction = Vec3.from_deg_angle(before.angle)
            new_direction = matrix.transform_direction(old_direction)
            self.assertTrue(Vec3.from_deg_angle(after.angle).isclose(new_direction.normalize()))
            self.assertEqual(len(before.dash_length_items), len(after.dash_length_items))
            for a, b in zip(before.dash_length_items, after.dash_length_items):
                self.assertAlmostEqual(b, a * new_direction.magnitude, places=8)

    def test_translation_preserves_density_and_moves_pattern_origin(self):
        for scale in (0.005, 0.008, 0.5, 2):
            with self.subTest(scale=scale):
                doc, hatch = self.make_legend(scale=scale, angle=23)
                insert = doc.modelspace().add_blockref("legend", (-16000, 4200))
                transformed = next(insert.virtual_entities())
                self.assert_pattern_transformed_once(hatch, transformed, insert.matrix44())

    def test_rotated_scaled_insert_preserves_dash_and_angle(self):
        doc, hatch = self.make_legend(scale=0.005, angle=31)
        insert = doc.modelspace().add_blockref(
            "legend", (1200, -3400), dxfattribs={"rotation": 47, "xscale": 3, "yscale": 3, "zscale": 3}
        )
        self.assert_pattern_transformed_once(hatch, next(insert.virtual_entities()), insert.matrix44())

    def test_nested_insert_does_not_apply_original_scale_again(self):
        doc, hatch = self.make_legend(scale=0.005, angle=17)
        parent = doc.blocks.new("parent")
        inner = parent.add_blockref("legend", (30, -20), dxfattribs={"rotation": 13})
        outer = doc.modelspace().add_blockref("parent", (-16000, 4200), dxfattribs={"rotation": 29})
        virtual_inner = next(outer.virtual_entities())
        transformed = next(virtual_inner.virtual_entities())
        self.assert_pattern_transformed_once(hatch, transformed, inner.matrix44() @ outer.matrix44())


if __name__ == "__main__":
    unittest.main()

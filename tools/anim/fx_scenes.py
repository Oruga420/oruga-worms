"""Original abstract spell geometry; no character likenesses or source artwork."""

import math

import manimgx as m

CYAN = "#59E9FF"
WHITE = "#EDFDFF"
VIOLET = "#AD8BFF"
GOLD = "#FFC65F"
PINK = "#FF73AC"


def ring(radius: float, color: str, width: float = 3) -> m.Circle:
    return m.Circle(radius=radius, color=color, stroke_width=width, fill_opacity=0)


def radial_marks(count: int, inner: float, outer: float, color: str) -> m.VGroup:
    return m.VGroup(*(
        m.Line((math.cos(a) * inner, math.sin(a) * inner, 0),
               (math.cos(a) * outer, math.sin(a) * outer, 0),
               color=color, stroke_width=3)
        for a in (index * math.tau / count for index in range(count))
    ))


def room_bloom() -> m.VGroup:
    arcs = m.VGroup(*(
        m.Arc(radius=2.6, start_angle=angle, angle=0.7, color=WHITE, stroke_width=4)
        for angle in (0, math.pi / 2, math.pi, 3 * math.pi / 2)
    ))
    return m.VGroup(ring(2.2, CYAN, 5), ring(1.7, CYAN, 2), arcs,
                    radial_marks(8, 2.85, 3.15, CYAN), ring(0.25, WHITE, 4))


def hex_shield() -> m.VGroup:
    outer = m.RegularPolygon(n=6, color=VIOLET, stroke_width=5, fill_opacity=0.12)
    inner = m.RegularPolygon(n=6, color=WHITE, stroke_width=2, fill_opacity=0)
    outer.scale(2.7)
    inner.scale(2.35)
    return m.VGroup(outer, inner, radial_marks(6, 2.95, 3.2, VIOLET),
                    ring(0.22, WHITE, 4))


def time_stop_clock() -> m.VGroup:
    hands = m.VGroup(m.Line((0, 0, 0), (0, 1.5, 0), color=WHITE, stroke_width=5),
                     m.Line((0, 0, 0), (1.05, -0.6, 0), color=GOLD, stroke_width=5))
    return m.VGroup(ring(2.55, GOLD, 5), ring(2.8, GOLD, 1.5),
                    radial_marks(12, 1.95, 2.2, GOLD), hands, ring(0.18, WHITE, 4))


def slash_spark() -> m.VGroup:
    blades = tuple(
        m.Polygon((-2.9 + offset, -1.8, 0), (1.9 + offset, 2.7, 0),
                  (0.4 + offset, 0.45, 0), color=color,
                  stroke_width=1, fill_color=color, fill_opacity=0.9)
        for offset, color in ((0, WHITE), (-0.7, PINK), (0.7, PINK))
    )
    # Leave room for rotation and the expanding fade instead of clipping the blade tips.
    return m.VGroup(*blades, radial_marks(8, 2.8, 3.2, GOLD)).scale(0.86)


def immortality_wings() -> m.VGroup:
    facets = tuple(
        m.Polygon((side * 0.35, -0.3, 0), (side * (2.9 - i * 0.45), 2.5 - i * 0.55, 0),
                  (side * (2.1 - i * 0.35), -0.8 - i * 0.28, 0),
                  color=WHITE if i == 0 else GOLD, stroke_width=2,
                  fill_color=GOLD, fill_opacity=0.22 + i * 0.08)
        for side in (-1, 1) for i in range(3)
    )
    diamond = m.RegularPolygon(n=4, color=WHITE, stroke_width=3,
                               fill_color=GOLD, fill_opacity=0.4)
    diamond.scale(0.48)
    return m.VGroup(*facets, diamond, ring(0.85, GOLD, 2).shift((0, 2.0, 0)))


SCENES = {
    "room-bloom": (room_bloom, math.pi / 4),
    "hex-shield": (hex_shield, math.pi / 6),
    "time-stop-clock": (time_stop_clock, -math.pi / 4),
    "slash-spark": (slash_spark, math.pi / 8),
    "immortality-wings": (immortality_wings, 0.05),
}


class SpellScene(m.Scene):
    def __init__(self, spell: str) -> None:
        self.spell = spell
        super().__init__()

    def construct(self) -> None:
        factory, turn = SCENES[self.spell]
        shape = factory()
        # Manim stroke units target presentation resolution; retain legible lines at 160px.
        for part in shape.family_members_with_points():
            part.set_stroke(width=part.get_stroke_width() * 4)
        self.play(m.FadeIn(shape, scale=0.35), run_time=6 / 24)
        self.play(m.Rotate(shape, angle=turn), run_time=10 / 24)
        self.wait(2 / 24)
        self.play(m.FadeOut(shape, scale=1.12), run_time=6 / 24)
        # A one-shot animator clamps at its final frame, so finish genuinely empty.
        self.wait(1 / 24)

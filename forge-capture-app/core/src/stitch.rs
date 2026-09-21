//! Shared stitch/result layer (ChatGPT Rung 2 contract #4, second half).
//!
//! Both acquisition engines — the 2a native raster engine and the 2b
//! scrolling engines (DOM-aware and raster-observation) — feed this one
//! layer. In 2a the layer is geometric: tile placements are validated and
//! coverage is computed (covered vs missing regions), which is exactly the
//! evidence an [`crate::result::ScrollingResult::Incomplete`] carries.
//! Pixel compositing is a 2b concern and changes nothing here.

use crate::coords::RectI;

/// One tile's placement on the final canvas, in physical-raster coordinates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilePlacement {
    pub tile_id: String,
    pub rect: RectI,
    /// Desired compositing order when tiles overlap (higher `z` on top).
    /// Recorded for the 2b compositor; [`StitchPlan::coverage`] is a *union*
    /// computation and does not consult `z`.
    pub z: u32,
}

/// A plan for assembling tiles into a canvas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StitchPlan {
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub tiles: Vec<TilePlacement>,
}

/// Coverage report: what has pixels and what does not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coverage {
    pub covered: Vec<RectI>,
    pub missing: Vec<RectI>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StitchError {
    EmptyCanvas,
    CanvasTooLarge { width: u32, height: u32 },
    NoTiles,
    TileOutsideCanvas { tile_id: String },
    EmptyTile { tile_id: String },
}

impl std::fmt::Display for StitchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StitchError::EmptyCanvas => write!(f, "stitch canvas has zero width or height"),
            StitchError::CanvasTooLarge { width, height } => {
                write!(f, "stitch canvas {width}x{height} exceeds the 16384px cap")
            }
            StitchError::NoTiles => write!(f, "stitch plan has no tiles"),
            StitchError::TileOutsideCanvas { tile_id } => {
                write!(f, "tile {tile_id} is not fully inside the canvas")
            }
            StitchError::EmptyTile { tile_id } => write!(f, "tile {tile_id} is empty"),
        }
    }
}

impl std::error::Error for StitchError {}

impl StitchPlan {
    /// Structural validation: canvas sane, at least one tile, every tile
    /// non-empty and fully inside the canvas. Tiles may overlap — `z`
    /// records the intended compositing order (a 2b concern) and does not
    /// affect validation; gaps are reported by [`StitchPlan::coverage`],
    /// not here.
    pub fn validate(&self) -> Result<(), StitchError> {
        if self.canvas_width == 0 || self.canvas_height == 0 {
            return Err(StitchError::EmptyCanvas);
        }
        if self.canvas_width > crate::artifact::MAX_ARTIFACT_DIMENSION
            || self.canvas_height > crate::artifact::MAX_ARTIFACT_DIMENSION
        {
            return Err(StitchError::CanvasTooLarge {
                width: self.canvas_width,
                height: self.canvas_height,
            });
        }
        if self.tiles.is_empty() {
            return Err(StitchError::NoTiles);
        }
        let canvas = RectI {
            x: 0,
            y: 0,
            w: self.canvas_width as u64,
            h: self.canvas_height as u64,
        };
        for t in &self.tiles {
            if t.rect.is_empty() {
                return Err(StitchError::EmptyTile {
                    tile_id: t.tile_id.clone(),
                });
            }
            if !canvas.contains_rect(t.rect) {
                return Err(StitchError::TileOutsideCanvas {
                    tile_id: t.tile_id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Compute covered vs missing regions of the canvas as the *union* of
    /// tile rects: a region counts as covered when any tile covers it,
    /// regardless of `z` (z-order only matters for compositing, which is a
    /// 2b concern). Missing regions are the evidence for an `Incomplete`
    /// scrolling result.
    pub fn coverage(&self) -> Coverage {
        let canvas = RectI {
            x: 0,
            y: 0,
            w: self.canvas_width as u64,
            h: self.canvas_height as u64,
        };
        let covered: Vec<RectI> = self.tiles.iter().map(|t| t.rect).collect();
        let missing = subtract_rect(canvas, &covered);
        Coverage { covered, missing }
    }
}

/// `base` minus every rect in `cutters`, as a list of non-overlapping rects.
pub fn subtract_rect(base: RectI, cutters: &[RectI]) -> Vec<RectI> {
    let mut pieces = if base.is_empty() { vec![] } else { vec![base] };
    for c in cutters {
        let mut next = Vec::new();
        for p in pieces {
            match p.intersect(*c) {
                None => next.push(p),
                Some(hit) => {
                    // Left strip.
                    if hit.x > p.x {
                        next.push(RectI {
                            x: p.x,
                            y: p.y,
                            w: (hit.x - p.x) as u64,
                            h: p.h,
                        });
                    }
                    // Right strip.
                    if hit.right() < p.right() {
                        next.push(RectI {
                            x: hit.right(),
                            y: p.y,
                            w: (p.right() - hit.right()) as u64,
                            h: p.h,
                        });
                    }
                    // Top strip (between hit's x-range).
                    if hit.y > p.y {
                        next.push(RectI {
                            x: hit.x,
                            y: p.y,
                            w: hit.w,
                            h: (hit.y - p.y) as u64,
                        });
                    }
                    // Bottom strip.
                    if hit.bottom() < p.bottom() {
                        next.push(RectI {
                            x: hit.x,
                            y: hit.bottom(),
                            w: hit.w,
                            h: (p.bottom() - hit.bottom()) as u64,
                        });
                    }
                }
            }
        }
        pieces = next;
    }
    pieces.into_iter().filter(|r| !r.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_2x2_missing_one() -> StitchPlan {
        StitchPlan {
            canvas_width: 200,
            canvas_height: 200,
            tiles: vec![
                TilePlacement {
                    tile_id: "t0".into(),
                    rect: RectI {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 100,
                    },
                    z: 0,
                },
                TilePlacement {
                    tile_id: "t1".into(),
                    rect: RectI {
                        x: 100,
                        y: 0,
                        w: 100,
                        h: 100,
                    },
                    z: 0,
                },
                TilePlacement {
                    tile_id: "t2".into(),
                    rect: RectI {
                        x: 0,
                        y: 100,
                        w: 100,
                        h: 100,
                    },
                    z: 0,
                },
                // bottom-right 100x100 missing
            ],
        }
    }

    #[test]
    fn full_coverage_has_no_missing() {
        let mut plan = plan_2x2_missing_one();
        plan.tiles.push(TilePlacement {
            tile_id: "t3".into(),
            rect: RectI {
                x: 100,
                y: 100,
                w: 100,
                h: 100,
            },
            z: 0,
        });
        plan.validate().unwrap();
        let cov = plan.coverage();
        assert!(cov.missing.is_empty());
        assert_eq!(cov.covered.len(), 4);
    }

    #[test]
    fn missing_tile_is_reported_exactly() {
        let plan = plan_2x2_missing_one();
        plan.validate().unwrap();
        let cov = plan.coverage();
        assert_eq!(
            cov.missing,
            vec![RectI {
                x: 100,
                y: 100,
                w: 100,
                h: 100
            }]
        );
    }

    #[test]
    fn overlapping_tiles_do_not_create_phantom_gaps() {
        let plan = StitchPlan {
            canvas_width: 100,
            canvas_height: 100,
            tiles: vec![
                TilePlacement {
                    tile_id: "a".into(),
                    rect: RectI {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 100,
                    },
                    z: 0,
                },
                TilePlacement {
                    tile_id: "b".into(),
                    rect: RectI {
                        x: 25,
                        y: 25,
                        w: 50,
                        h: 50,
                    },
                    z: 1,
                },
            ],
        };
        plan.validate().unwrap();
        assert!(plan.coverage().missing.is_empty());
    }

    #[test]
    fn validation_rejects_bad_plans() {
        let empty_canvas = StitchPlan {
            canvas_width: 0,
            canvas_height: 100,
            tiles: vec![],
        };
        assert_eq!(
            empty_canvas.validate().unwrap_err(),
            StitchError::EmptyCanvas
        );

        let no_tiles = StitchPlan {
            canvas_width: 100,
            canvas_height: 100,
            tiles: vec![],
        };
        assert_eq!(no_tiles.validate().unwrap_err(), StitchError::NoTiles);

        let outside = StitchPlan {
            canvas_width: 100,
            canvas_height: 100,
            tiles: vec![TilePlacement {
                tile_id: "o".into(),
                rect: RectI {
                    x: 90,
                    y: 90,
                    w: 20,
                    h: 20,
                },
                z: 0,
            }],
        };
        assert_eq!(
            outside.validate().unwrap_err(),
            StitchError::TileOutsideCanvas {
                tile_id: "o".into()
            }
        );

        let empty_tile = StitchPlan {
            canvas_width: 100,
            canvas_height: 100,
            tiles: vec![TilePlacement {
                tile_id: "e".into(),
                rect: RectI {
                    x: 10,
                    y: 10,
                    w: 0,
                    h: 10,
                },
                z: 0,
            }],
        };
        assert_eq!(
            empty_tile.validate().unwrap_err(),
            StitchError::EmptyTile {
                tile_id: "e".into()
            }
        );
    }

    #[test]
    fn subtract_rect_splits_into_four() {
        let base = RectI {
            x: 0,
            y: 0,
            w: 100,
            h: 100,
        };
        let hole = RectI {
            x: 25,
            y: 25,
            w: 50,
            h: 50,
        };
        let pieces = subtract_rect(base, &[hole]);
        assert_eq!(pieces.len(), 4);
        let area: u64 = pieces.iter().map(|r| r.area()).sum();
        assert_eq!(area, 100 * 100 - 50 * 50);
        // No piece overlaps the hole.
        for p in &pieces {
            assert!(p.intersect(hole).is_none());
        }
    }

    #[test]
    fn subtract_rect_edge_cutter() {
        // Cutter covering the left half leaves exactly the right half.
        let base = RectI {
            x: 0,
            y: 0,
            w: 100,
            h: 100,
        };
        let left = RectI {
            x: 0,
            y: 0,
            w: 50,
            h: 100,
        };
        assert_eq!(
            subtract_rect(base, &[left]),
            vec![RectI {
                x: 50,
                y: 0,
                w: 50,
                h: 100
            }]
        );
    }
}

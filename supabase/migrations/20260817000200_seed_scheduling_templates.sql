-- Starter lane/block templates for schedule_projects.project_type. See docs/scheduling/SPEC.md §2.2.
-- Chip "durationWeeks" matches the week-granularity board ported from docs/scheduling/prototype.html
-- in phase 2 -- it is not the same unit as schedule_blocks.duration_days (a later, calendar/CPM-phase
-- concern once actual blocks are placed and persisted).

insert into schedule_templates (id, project_type, name, template) values (
  'schedule_template_capital_industrial',
  'capital_industrial',
  'Capital / Industrial',
  '{
    "lanes": [
      {"key": "lane_ms", "name": "Milestones", "color": "#f0b429"},
      {"key": "lane_gov", "name": "Governance", "color": "#7c5cff"},
      {"key": "lane_eng", "name": "Engineering", "color": "#0fa38f"},
      {"key": "lane_proc", "name": "Procurement", "color": "#dd9a2e"},
      {"key": "lane_field1", "name": "Field Execution", "color": "#2f6fed"},
      {"key": "lane_field2", "name": "Field Execution (cont.)", "color": "#2f6fed"},
      {"key": "lane_shut", "name": "Shutdown & Startup", "color": "#e0483f"}
    ],
    "chips": [
      {"label": "Kickoff", "category": "gov", "durationWeeks": 0, "milestone": true},
      {"label": "Charter Approval", "category": "gov", "durationWeeks": 1, "milestone": false},
      {"label": "Stage Gate Review", "category": "gov", "durationWeeks": 1, "milestone": false},
      {"label": "Investment / Funding Approval", "category": "gov", "durationWeeks": 0, "milestone": true},
      {"label": "Steering Committee Review", "category": "gov", "durationWeeks": 1, "milestone": false},
      {"label": "Management of Change (MOC)", "category": "gov", "durationWeeks": 2, "milestone": false},
      {"label": "Conceptual Design", "category": "eng", "durationWeeks": 4, "milestone": false},
      {"label": "Feasibility / FEED", "category": "eng", "durationWeeks": 6, "milestone": false},
      {"label": "Detailed Design", "category": "eng", "durationWeeks": 8, "milestone": false},
      {"label": "Civil Engineering", "category": "eng", "durationWeeks": 5, "milestone": false},
      {"label": "Mechanical Engineering", "category": "eng", "durationWeeks": 5, "milestone": false},
      {"label": "Electrical Engineering", "category": "eng", "durationWeeks": 5, "milestone": false},
      {"label": "Instrumentation Engineering", "category": "eng", "durationWeeks": 5, "milestone": false},
      {"label": "Process Engineering", "category": "eng", "durationWeeks": 5, "milestone": false},
      {"label": "RFQ Issued", "category": "proc", "durationWeeks": 0, "milestone": true},
      {"label": "Bid Evaluation", "category": "proc", "durationWeeks": 3, "milestone": false},
      {"label": "PO Issued", "category": "proc", "durationWeeks": 0, "milestone": true},
      {"label": "Long-Lead Equipment Fabrication", "category": "proc", "durationWeeks": 12, "milestone": false},
      {"label": "Vendor Data Review", "category": "proc", "durationWeeks": 4, "milestone": false},
      {"label": "Equipment Delivery", "category": "proc", "durationWeeks": 0, "milestone": true},
      {"label": "Site Mobilization", "category": "field", "durationWeeks": 0, "milestone": true},
      {"label": "Civil / Foundations", "category": "field", "durationWeeks": 4, "milestone": false},
      {"label": "Structural Steel", "category": "field", "durationWeeks": 5, "milestone": false},
      {"label": "Piping Install", "category": "field", "durationWeeks": 6, "milestone": false},
      {"label": "Electrical Install", "category": "field", "durationWeeks": 5, "milestone": false},
      {"label": "Instrumentation Install", "category": "field", "durationWeeks": 4, "milestone": false},
      {"label": "Mechanical Install", "category": "field", "durationWeeks": 5, "milestone": false},
      {"label": "Insulation & Paint", "category": "field", "durationWeeks": 3, "milestone": false},
      {"label": "Turnaround Window", "category": "shut", "durationWeeks": 3, "milestone": false},
      {"label": "Pre-Job Safety Walkdown", "category": "shut", "durationWeeks": 1, "milestone": false},
      {"label": "Commissioning", "category": "shut", "durationWeeks": 3, "milestone": false},
      {"label": "Startup", "category": "shut", "durationWeeks": 2, "milestone": false},
      {"label": "Pre-Startup Safety Review (PSSR)", "category": "shut", "durationWeeks": 0, "milestone": true},
      {"label": "Return to Service", "category": "shut", "durationWeeks": 0, "milestone": true}
    ]
  }'::jsonb
) on conflict (id) do update set name = excluded.name, template = excluded.template;

-- Sketch-level content only (per docs/scheduling/claude-code-handover.md §8) -- one lane per
-- named category with a starter milestone + generic task chip. Real content is a later pass.
insert into schedule_templates (id, project_type, name, template) values (
  'schedule_template_commercial_construction',
  'commercial_construction',
  'Commercial Construction',
  '{
    "lanes": [
      {"key": "lane_permit", "name": "Permitting", "color": "#7c5cff"},
      {"key": "lane_site", "name": "Sitework", "color": "#dd9a2e"},
      {"key": "lane_fnd", "name": "Foundation", "color": "#c9622a"},
      {"key": "lane_struct", "name": "Structure", "color": "#2f6fed"},
      {"key": "lane_env", "name": "Envelope", "color": "#0fa38f"},
      {"key": "lane_mep", "name": "MEP Rough-in", "color": "#4c8b5a"},
      {"key": "lane_fin", "name": "Interior Finish", "color": "#e0483f"},
      {"key": "lane_insp", "name": "Inspections / Closeout", "color": "#f0b429"}
    ],
    "chips": [
      {"label": "Permitting Start", "category": "permit", "durationWeeks": 0, "milestone": true},
      {"label": "Permitting Work", "category": "permit", "durationWeeks": 3, "milestone": false},
      {"label": "Sitework Start", "category": "site", "durationWeeks": 0, "milestone": true},
      {"label": "Sitework", "category": "site", "durationWeeks": 3, "milestone": false},
      {"label": "Foundation Start", "category": "fnd", "durationWeeks": 0, "milestone": true},
      {"label": "Foundation Work", "category": "fnd", "durationWeeks": 4, "milestone": false},
      {"label": "Structure Start", "category": "struct", "durationWeeks": 0, "milestone": true},
      {"label": "Structural Steel / Framing", "category": "struct", "durationWeeks": 6, "milestone": false},
      {"label": "Envelope Start", "category": "env", "durationWeeks": 0, "milestone": true},
      {"label": "Building Envelope", "category": "env", "durationWeeks": 5, "milestone": false},
      {"label": "MEP Rough-in Start", "category": "mep", "durationWeeks": 0, "milestone": true},
      {"label": "MEP Rough-in", "category": "mep", "durationWeeks": 5, "milestone": false},
      {"label": "Interior Finish Start", "category": "fin", "durationWeeks": 0, "milestone": true},
      {"label": "Interior Finish", "category": "fin", "durationWeeks": 6, "milestone": false},
      {"label": "Final Inspection", "category": "insp", "durationWeeks": 1, "milestone": false},
      {"label": "Certificate of Occupancy", "category": "insp", "durationWeeks": 0, "milestone": true}
    ]
  }'::jsonb
) on conflict (id) do update set name = excluded.name, template = excluded.template;

insert into schedule_templates (id, project_type, name, template) values (
  'schedule_template_residential_construction',
  'residential_construction',
  'Residential Construction',
  '{
    "lanes": [
      {"key": "lane_permit", "name": "Permitting", "color": "#7c5cff"},
      {"key": "lane_frame", "name": "Framing", "color": "#2f6fed"},
      {"key": "lane_roof", "name": "Roofing", "color": "#c9622a"},
      {"key": "lane_rough", "name": "Rough-ins (Plumbing/Electrical/HVAC)", "color": "#0fa38f"},
      {"key": "lane_dry", "name": "Drywall", "color": "#dd9a2e"},
      {"key": "lane_trim", "name": "Trim / Finish", "color": "#4c8b5a"},
      {"key": "lane_final", "name": "Final Inspection", "color": "#f0b429"}
    ],
    "chips": [
      {"label": "Permitting Start", "category": "permit", "durationWeeks": 0, "milestone": true},
      {"label": "Permitting Work", "category": "permit", "durationWeeks": 2, "milestone": false},
      {"label": "Framing Start", "category": "frame", "durationWeeks": 0, "milestone": true},
      {"label": "Framing", "category": "frame", "durationWeeks": 3, "milestone": false},
      {"label": "Roofing", "category": "roof", "durationWeeks": 1, "milestone": false},
      {"label": "Rough-in Start", "category": "rough", "durationWeeks": 0, "milestone": true},
      {"label": "Plumbing Rough-in", "category": "rough", "durationWeeks": 1, "milestone": false},
      {"label": "Electrical Rough-in", "category": "rough", "durationWeeks": 1, "milestone": false},
      {"label": "HVAC Rough-in", "category": "rough", "durationWeeks": 1, "milestone": false},
      {"label": "Drywall", "category": "dry", "durationWeeks": 2, "milestone": false},
      {"label": "Trim / Finish", "category": "trim", "durationWeeks": 2, "milestone": false},
      {"label": "Final Inspection", "category": "final", "durationWeeks": 1, "milestone": false},
      {"label": "Certificate of Occupancy", "category": "final", "durationWeeks": 0, "milestone": true}
    ]
  }'::jsonb
) on conflict (id) do update set name = excluded.name, template = excluded.template;

insert into schedule_templates (id, project_type, name, template) values (
  'schedule_template_custom',
  'custom',
  'Custom / Blank',
  '{"lanes": [], "chips": []}'::jsonb
) on conflict (id) do update set name = excluded.name, template = excluded.template;

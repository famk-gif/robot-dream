// Parametric robot model with servo cavities (OpenSCAD)
// Units: mm
// Set part to export a specific piece.
// Options: assembly, base_bottom, base_top, column_lower, column_upper,
//          chest_left, chest_right, neck, head_top, head_bottom,
//          wheel_left, wheel_right, wheel_mount_left, wheel_mount_right,
//          arm_upper_left, arm_upper_right, arm_lower_left, arm_lower_right,
//          hand_left, hand_right

part = is_undef(part) ? "assembly" : part;
$fn = 48;

wall = 2.4;
clearance = 0.6;

base = [260, 260, 40];
column = [90, 90, 70];
chest = [160, 120, 140];
neck = [60, 60, 20];
head = [90, 90, 80];

wheel_r = 30;
wheel_t = 16;
wheel_mount = [44, 30, 70];

arm_upper = [30, 30, 85];
arm_lower = [26, 26, 85];
hand = [16, 16, 20];

// Servo dimensions (body only). Adjust if your batch differs.
mg996_body = [41, 21, 41];
mg996_ear_span = 48.5;
mg996_ear_offset = 5.0;
mg996_slot = [10, 3.2];

mg90_body = [23, 12, 23];
mg90_ear_span = 27.5;
mg90_ear_offset = 3.0;
mg90_slot = [8, 2.6];

shoulder_span = 180;
base_lift = wheel_r * 2;

module shell_box(size, wall, open_top=false, open_bottom=false) {
  inner = [size[0] - 2 * wall, size[1] - 2 * wall, size[2] - (open_top ? 0 : wall) - (open_bottom ? 0 : wall)];
  inner_z = max(0, inner[2]);
  difference() {
    cube(size, center=false);
    translate([wall, wall, open_bottom ? 0 : wall])
      cube([inner[0], inner[1], inner_z], center=false);
  }
}

module centered_shell(size, wall, open_top=false, open_bottom=false) {
  translate([-size[0] / 2, -size[1] / 2, 0]) shell_box(size, wall, open_top, open_bottom);
}

module slot_hole(length, width, depth) {
  linear_extrude(height=depth, center=true)
    hull() {
      translate([length / 2 - width / 2, 0]) circle(d=width);
      translate([-length / 2 + width / 2, 0]) circle(d=width);
    }
}

module servo_body_cutout(size, clearance) {
  cube([size[0] + clearance, size[1] + clearance, size[2] + clearance], center=true);
}

module servo_slots(ear_span, ear_offset, slot, depth) {
  for (sx = [-1, 1])
    for (sy = [-1, 1])
      translate([sx * ear_span / 2, sy * ear_offset, 0]) slot_hole(slot[0], slot[1], depth);
}

module base_bottom() { centered_shell(base, wall, open_top=true, open_bottom=false); }
module base_top() { centered_shell(base, wall, open_top=false, open_bottom=true); }
module column_block() { centered_shell(column, wall, open_top=true, open_bottom=true); }
module neck_block() { centered_shell(neck, wall, open_top=false, open_bottom=false); }

module chest_shell() { centered_shell(chest, wall, open_top=true, open_bottom=true); }
module chest_half(side="left") {
  side_sign = (side == "left") ? 1 : -1;
  shoulder_z = chest[2] - 40;
  difference() {
    intersection() {
      chest_shell();
      if (side == "left")
        translate([-chest[0] / 2, -chest[1], -1]) cube([chest[0] / 2, chest[1] * 2, chest[2] + 2], center=false);
      else
        translate([0, -chest[1], -1]) cube([chest[0] / 2, chest[1] * 2, chest[2] + 2], center=false);
    }

    translate([side_sign * (chest[0] / 2 - mg996_body[0] / 2 - wall), 0, shoulder_z])
      servo_body_cutout(mg996_body, clearance);

    translate([side_sign * (chest[0] / 2 - wall / 2), 0, shoulder_z])
      cube([wall + 2, mg996_body[1] + 6, mg996_body[2] + 6], center=true);

    translate([side_sign * (chest[0] / 2 - wall / 2), 0, shoulder_z])
      rotate([0, 90, 0]) servo_slots(mg996_ear_span, mg996_ear_offset, mg996_slot, wall + 2);
  }
}

module head_shell() { centered_shell(head, wall, open_top=false, open_bottom=true); }
module head_half(side="left") {
  intersection() {
    head_shell();
    if (side == "left")
      translate([-head[0] / 2, -head[1], -1]) cube([head[0] / 2, head[1] * 2, head[2] + 2], center=false);
    else
      translate([0, -head[1], -1]) cube([head[0] / 2, head[1] * 2, head[2] + 2], center=false);
  }
}

module wheel() {
  rotate([0, 90, 0]) cylinder(h=wheel_t, r=wheel_r, center=true);
}

module wheel_mount_block() {
  translate([-wheel_mount[0] / 2, -wheel_mount[1] / 2, -wheel_mount[2] / 2]) cube(wheel_mount, center=false);
}

module arm_upper_block(side="left") {
  side_sign = (side == "left") ? 1 : -1;
  servo_z = arm_upper[2] - mg996_body[2] / 2 - 10;
  difference() {
    translate([-arm_upper[0] / 2, -arm_upper[1] / 2, 0]) cube(arm_upper);

    translate([0, 0, servo_z]) servo_body_cutout(mg996_body, clearance);

    translate([side_sign * (arm_upper[0] / 2 - wall / 2), 0, servo_z])
      cube([wall + 2, mg996_body[1] + 6, mg996_body[2] + 6], center=true);

    translate([side_sign * (arm_upper[0] / 2 - wall / 2), 0, servo_z])
      rotate([0, 90, 0]) servo_slots(mg996_ear_span, mg996_ear_offset, mg996_slot, wall + 2);
  }
}

module arm_lower_block(side="left") {
  side_sign = (side == "left") ? 1 : -1;
  servo_z = mg90_body[2] / 2 + 8;
  difference() {
    translate([-arm_lower[0] / 2, -arm_lower[1] / 2, 0]) cube(arm_lower);

    translate([0, 0, servo_z]) servo_body_cutout(mg90_body, clearance);

    translate([side_sign * (arm_lower[0] / 2 - wall / 2), 0, servo_z])
      cube([wall + 2, mg90_body[1] + 5, mg90_body[2] + 5], center=true);

    translate([side_sign * (arm_lower[0] / 2 - wall / 2), 0, servo_z])
      rotate([0, 90, 0]) servo_slots(mg90_ear_span, mg90_ear_offset, mg90_slot, wall + 2);
  }
}

module hand_block() { translate([-hand[0] / 2, -hand[1] / 2, 0]) cube(hand); }

module assembly() {
  translate([0, 0, base_lift]) base_bottom();
  translate([0, 0, base_lift + base[2]]) base_top();

  translate([0, 0, base_lift + base[2]]) column_block();
  translate([0, 0, base_lift + base[2] + column[2]]) chest_shell();
  translate([0, 0, base_lift + base[2] + column[2] + chest[2]]) neck_block();
  translate([0, 0, base_lift + base[2] + column[2] + chest[2] + neck[2]]) head_shell();

  translate([-(base[0] / 2 + wheel_mount[0] / 2), 0, wheel_r]) wheel_mount_block();
  translate([(base[0] / 2 + wheel_mount[0] / 2), 0, wheel_r]) wheel_mount_block();

  translate([-(base[0] / 2 + wheel_mount[0]), 0, wheel_r]) wheel();
  translate([(base[0] / 2 + wheel_mount[0]), 0, wheel_r]) wheel();

  translate([-shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6]) arm_upper_block("left");
  translate([shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6]) arm_upper_block("right");
  translate([-shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6 - arm_upper[2]]) arm_lower_block("left");
  translate([shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6 - arm_upper[2]]) arm_lower_block("right");
  translate([-shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6 - arm_upper[2] - arm_lower[2]]) hand_block();
  translate([shoulder_span / 2, 0, base_lift + base[2] + column[2] + chest[2] - 6 - arm_upper[2] - arm_lower[2]]) hand_block();
}

if (part == "assembly") assembly();
if (part == "base_bottom") translate([0,0,0]) base_bottom();
if (part == "base_top") translate([0,0,0]) base_top();
if (part == "column_lower") translate([0,0,0]) column_block();
if (part == "column_upper") translate([0,0,0]) column_block();
if (part == "chest_left") chest_half("left");
if (part == "chest_right") chest_half("right");
if (part == "neck") neck_block();
if (part == "head_top") head_half("left");
if (part == "head_bottom") head_half("right");
if (part == "wheel_left") wheel();
if (part == "wheel_right") wheel();
if (part == "wheel_mount_left") wheel_mount_block();
if (part == "wheel_mount_right") wheel_mount_block();
if (part == "arm_upper_left") arm_upper_block("left");
if (part == "arm_upper_right") arm_upper_block("right");
if (part == "arm_lower_left") arm_lower_block("left");
if (part == "arm_lower_right") arm_lower_block("right");
if (part == "hand_left") hand_block();
if (part == "hand_right") hand_block();


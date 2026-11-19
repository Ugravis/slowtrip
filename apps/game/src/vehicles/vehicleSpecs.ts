export type VehicleId = 'van' | 'offroad'
export type Drivetrain = 'rwd' | 'awd'

/**
 * Vehicle tuning. Local frame: +X right, +Y up, -Z forward (Three.js convention).
 * Distances in meters, masses in kg, forces in N.
 */
export interface VehicleSpec {
  id: VehicleId
  name: string
  mass: number
  /** Chassis collider half extents. */
  halfExtents: readonly [number, number, number]
  /** Center of mass offset from the chassis center (lower = more stable). */
  centerOfMassY: number
  wheelRadius: number
  wheelWidth: number
  /** Half distance between left and right wheels. */
  track: number
  frontZ: number
  rearZ: number
  /** Suspension attachment height relative to the chassis center. */
  wheelY: number
  suspensionRest: number
  suspensionTravel: number
  suspensionStiffness: number
  suspensionCompression: number
  suspensionRelaxation: number
  frictionSlip: number
  sideFrictionStiffness: number
  engineForce: number
  brakeForce: number
  maxSteer: number
  /** Top speed forward, m/s. */
  maxSpeed: number
  maxReverseSpeed: number
  drivetrain: Drivetrain
  /** Driver eye position in chassis space (first-person camera). */
  driverEye: readonly [number, number, number]
  /** Third-person camera distance and height. */
  chaseDistance: number
  chaseHeight: number
}

export const VAN: VehicleSpec = {
  id: 'van',
  name: 'Van',
  mass: 2200,
  halfExtents: [0.95, 0.85, 2.45],
  centerOfMassY: -0.45,
  wheelRadius: 0.38,
  wheelWidth: 0.26,
  track: 0.9,
  frontZ: -1.6,
  rearZ: 1.55,
  wheelY: -0.75,
  suspensionRest: 0.4,
  suspensionTravel: 0.25,
  suspensionStiffness: 28,
  suspensionCompression: 2.6,
  suspensionRelaxation: 3.2,
  frictionSlip: 1.6,
  sideFrictionStiffness: 1,
  engineForce: 9000,
  brakeForce: 90,
  maxSteer: 0.55,
  maxSpeed: 31, // ~110 km/h
  maxReverseSpeed: 7,
  drivetrain: 'rwd',
  driverEye: [-0.45, 0.65, -1.15],
  chaseDistance: 9,
  chaseHeight: 3.2,
}

export const OFFROAD: VehicleSpec = {
  id: 'offroad',
  name: '4x4',
  mass: 1900,
  halfExtents: [0.92, 0.6, 2.15],
  centerOfMassY: -0.4,
  wheelRadius: 0.46,
  wheelWidth: 0.32,
  track: 0.88,
  frontZ: -1.35,
  rearZ: 1.35,
  wheelY: -0.45,
  suspensionRest: 0.5,
  suspensionTravel: 0.35,
  suspensionStiffness: 24,
  suspensionCompression: 2.4,
  suspensionRelaxation: 3,
  frictionSlip: 2,
  sideFrictionStiffness: 1,
  engineForce: 8000,
  brakeForce: 90,
  maxSteer: 0.6,
  maxSpeed: 36, // ~130 km/h
  maxReverseSpeed: 8,
  drivetrain: 'awd',
  driverEye: [-0.42, 0.62, -0.35],
  chaseDistance: 8,
  chaseHeight: 2.8,
}

export const VEHICLE_SPECS: Record<VehicleId, VehicleSpec> = { van: VAN, offroad: OFFROAD }

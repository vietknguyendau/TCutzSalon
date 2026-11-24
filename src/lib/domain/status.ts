import type { AppointmentStatus } from "./types";

/** Allowed status transitions. Anything not listed is rejected server-side. */
export const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending_approval: ["booked", "canceled"],
  booked: ["confirmed", "arrived", "canceled", "no_show"],
  confirmed: ["arrived", "canceled", "no_show"],
  arrived: ["in_progress", "completed", "canceled"],
  in_progress: ["completed"],
  completed: [],
  canceled: [],
  no_show: ["arrived"], // late arrival
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** The single most likely next action, shown as the big button on the appointment card. */
export function primaryNextStatus(s: AppointmentStatus): AppointmentStatus | null {
  switch (s) {
    case "pending_approval":
      return "booked";
    case "booked":
    case "confirmed":
      return "arrived";
    case "arrived":
      return "in_progress";
    case "in_progress":
      return "completed";
    default:
      return null;
  }
}

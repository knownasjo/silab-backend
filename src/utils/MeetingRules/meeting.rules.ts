export const isMeetingHeld = (isOpen: boolean, attendanceCount: number) =>
  isOpen || attendanceCount > 0;

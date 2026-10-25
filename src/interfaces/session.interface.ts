export interface ISessionRequestBody {
  room?: string;
  day?: string;
  number?: number;
  startAt?: string;
  endAt?: string;
  isActive?: boolean;
  alsoDays?: string[];
}

export interface ISessionResponseBody {
  id: string;
  room: string;
  day: string;
  number: number;
  startAt: string;
  endAt: string;
  isActive: boolean;
  classes: number;
}

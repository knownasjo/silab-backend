export interface ISessionRequestBody {
  room?: string;
  day?: string;
  number?: number;
  startAt?: string;
  endAt?: string;
  is_active?: boolean;
  also_days?: string[];
}

export interface ISessionResponseBody {
  id: string;
  room: string;
  day: string;
  number: number;
  startAt: string;
  endAt: string;
  is_active: boolean;
  classes: number;
}

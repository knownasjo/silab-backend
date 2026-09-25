export interface ISessionRequestBody {
  day_group?: string;
  number?: number;
  startAt?: string;
  endAt?: string;
  is_active?: boolean;
}

export interface ISessionResponseBody {
  id: string;
  day_group: string;
  number: number;
  startAt: string;
  endAt: string;
  is_active: boolean;
  classes: number;
}

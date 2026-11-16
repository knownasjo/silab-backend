export interface IActivityActorResponseBody {
  id: string | null;
  name: string;
  nim: string | null;
  role: string;
}

export interface IActivityResponseBody {
  id: string;
  action: string;
  actionLabel: string;
  group: string;
  actor: IActivityActorResponseBody;
  description: string;
  change: string | null;
  attempts: number;
  periodId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface IActivityListResponseBody {
  items: IActivityResponseBody[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

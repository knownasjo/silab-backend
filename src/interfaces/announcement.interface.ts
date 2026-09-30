export interface IAddAnnouncementRequestBody {
  type: AnnouncementTypeEnum;
  title: string;
  body: string;
  subjectIds?: string[];
}

export enum AnnouncementTypeEnum {
  ASSISTANT = "ASSISTANT",
  PRACTICUM = "PRACTICUM",
  INHALL = "INHALL",
  BASIC = "BASIC",
}

export interface IGetAllAnnouncementsResponseBody {
  id: string;
  title: string;
  body: string;
  created_at: string;
  type: AnnouncementTypeEnum;
  author: string;
  for_all: boolean;
  subjects: IAnnouncementSubject[];
  period: string | null;
}

export interface IAnnouncementSubject {
  id: string;
  subject_name: string;
  subject_code: string;
}

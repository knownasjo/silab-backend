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
  createdAt: string;
  type: AnnouncementTypeEnum;
  author: string;
  forAll: boolean;
  subjects: IAnnouncementSubject[];
  period: string | null;
}

export interface IAnnouncementSubject {
  id: string;
  subjectName: string;
  subjectCode: string;
}

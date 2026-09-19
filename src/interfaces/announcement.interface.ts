export interface IAddAnnouncementRequestBody {
  type: AnnouncementTypeEnum;
  title: string;
  body: string;
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
}

export interface IAddCollaboratorRequestBody {
  classId: string;
  collaborators: string[];
}

export interface IGetCollaboratorsResponseBody {
  fullname: string;
}

export interface IAddCollaboratorRequestBody {
  classId: string;
  collaborators: string[];
}

export interface IGetCollaboratorsResponseBody {
  id: string;
  nim: string;
  fullname: string;
}

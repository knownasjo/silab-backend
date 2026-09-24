export interface IUserResponseBody {
  id: string;
  fullname: string;
  nim: string;
}

export interface IGetUserResponseBody {
  id: string;
  nim: string;
  fullname: string;
}

export interface ICreateUserRequestBody {
  email: string;
  nim: string;
  fullname: string;
  password: string;
  role: string;
}

export interface ICreateUserResponseBody {
  id: string;
  email: string;
  nim: string;
  fullname: string;
  role: string;
}

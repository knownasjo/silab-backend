import { UserRole } from "@prisma/client";

export interface IJWTUserPayload {
  id: string;
  nim: string;
  role: string;
  fullname: string;
}

export interface IUserLoginRequestBody {
  nim: string;
  password: string;
}

export interface IUserLoginResponseBody {
  accessToken: string;
  refreshToken: string;
}

export interface IUserRegisterRequestBody {
  nim: string;
  fullname: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
}

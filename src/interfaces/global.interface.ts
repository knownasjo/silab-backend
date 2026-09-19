export interface IBaseResponse<T = any> {
  status: boolean;
  message: string;
  data?: T;
}

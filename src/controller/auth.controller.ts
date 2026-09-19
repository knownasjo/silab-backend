import { NextFunction, Request, Response } from "express";
import { SUserLogin, SRegisterUser } from "../services/auth.service";

export const CUserLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SUserLogin(req.body);

    res.status(200).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CUserRegister = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = await SRegisterUser(req.body);

    res.status(201).json(resData);
  } catch (error: any) {
    next(error);
  }
};

export const CUserMe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resData = {
      status: true,
      message: "Success get user data!",
      data: {
        id: req?.user?.id,
        name: req.user?.fullname,
        email: req.user?.email,
        role: req.user?.role,
      },
    };

    res.status(200).json(resData);
  } catch (error) {
    next(error);
  }
};

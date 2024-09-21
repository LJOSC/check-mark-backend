import { NextFunction, Request, Response } from 'express';
import { MongoError } from 'mongodb';
import { validationResult } from 'express-validator';
import APIError from 'src/utils/APIError';
import messages from 'src/utils/responseMessages';
import * as userService from './user.service';
import { handleMongoError } from 'src/utils/handleMongoError';
import env from 'src/configs/envVars';
import { UserDoc } from 'models/User';

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * User signup controller
 */
export const userSignupHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const props = req.body;

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const result: any = await userService.addUser(props);

    return res.status(result.code).json(result);
  } catch (error: unknown) {
    if (error instanceof MongoError) {
      const handledError = handleMongoError(error as MongoError);
      res.status(400).json(handledError);
    } else if (error instanceof APIError) {
      next(error);
    } else {
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * User login controller
 */
export const userLoginHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const props = req.body;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const result: any = await userService.loginUser(props, res);

    return res.status(result.code).json(result);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * Verify email controller
 */
export const verifyEmailHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const { token } = req.params;
    const email = req.query.email as string;

    if (!email) {
      throw new APIError({
        message: 'Invalid verification link',
        status: 400,
      });
    }

    await userService.verifyEmail(token, email);

    return res.redirect(env.FRONTEND_LOGIN_URL);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * Refresh access token controller
 */
export const refreshAccessTokenHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const user = req.user as UserDoc;
    const oldToken = req.cookies.refreshToken;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const result: any = await userService.refreshAccessToken(user, oldToken, res);
    return res.status(200).send(result);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * User logout controller
 */
export const userLogoutHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const token = req.cookies.refreshToken;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }
    if (!token) {
      return res.status(200).json({ message: 'User already logged out' });
    }

    const result: any = await userService.logoutUser(token);
    res.clearCookie('refreshToken');

    return res.status(result.code).json(result);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * Forgot password controller
 */
export const forgotPasswordHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const email = req.body.email;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const result: any = await userService.forgotPassword(email);

    return res.status(result.code).json(result);
  } catch (error: unknown) {
    next(error);
  }
};

/**
 * @param {req} req - Requests
 * @param {res} res - Response
 * @param {next} next - next
 * Reset password controller
 */
export const resetPasswordHandler = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  try {
    const props = req.body;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      throw new APIError({
        message: messages.bodyInvalid,
        status: 400,
        stack: errors.array(),
      });
    }

    const result: any = await userService.resetPassword(props);

    return res.status(result.code).json(result);
  } catch (error: unknown) {
    next(error);
  }
};

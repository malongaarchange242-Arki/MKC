declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      role: 'CLIENT' | 'ADMIN' | 'SYSTEM';
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

export interface IAddActivationRequestBody {
  subjectIds: string[];
}

export interface IUpdateActivationRequestBody {
  classId?: string;
  status?: boolean;
}

export interface IGetActivationResponseBody {
  id: string;
  userId: string;
  nim: string;
  student: string;
  status: boolean;
  createdAt: string;
  subjectId: string;
  subjects: IStudentActivationPaymentStatus[];
  registeredClass: IRegisteredClass | null;
  availableClasses: IAvailableClass[];
}

export interface IStudentActivationPaymentStatus {
  subjectName: string;
  semester: string;
}

export interface IRegisteredClass {
  id: string;
  name: string;
}

export interface IAvailableClass {
  id: string;
  name: string;
  day: string;
  sessionTime: string;
  room: string;
  quota: number;
  registeredStudents: number;
  isFull: boolean;
}

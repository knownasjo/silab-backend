import express from "express";
import { errorHandler } from "./middleware/error.middleware";
import AuthRoute from "../src/routes/auth.route";
import SubjectRoute from "../src/routes/subject.route";
import ClassRoute from "../src/routes/class.route";
import ActivationRoute from "../src/routes/activation.route";
import MeetingRoute from "../src/routes/meeting.route";
import UserRoute from "../src/routes/user.route";
import AnnouncementRoute from "../src/routes/announcement.route";
import CollaboratorRoute from "../src/routes/collaborator.route";
import cors from "cors";

const app = express();

app.use(express.json());
app.use(cors());

app.listen(3000);

app.use("/auth", AuthRoute);
app.use("/subject", SubjectRoute);
app.use("/class", ClassRoute);
app.use("/activation", ActivationRoute);
app.use("/meeting", MeetingRoute);
app.use("/user", UserRoute);
app.use("/announcement", AnnouncementRoute);
app.use("/collaborator", CollaboratorRoute);

app.use(errorHandler);

import { Navigate, Route, Routes } from "react-router";
import { EVENT_ID } from "./config";
import { EventPage } from "./features/event/event-page";
import { FeedbackFormPage } from "./features/feedback-form/feedback-form-page";
import { NotFoundPage } from "./shared/ui/not-found-page";

/** React Router v7, declarative mode; data loading stays in React Query (T3 A14). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/events/${EVENT_ID}`} replace />} />
      <Route path="/events/:eventId" element={<EventPage />} />
      <Route path="/events/:eventId/feedback" element={<FeedbackFormPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

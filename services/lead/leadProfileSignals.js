import { buildAppointmentStatusByProfileIds } from './leadAppointmentStatus.js';
import { buildNurtureConsultationBookedFromEmailByProfileIds } from './leadNurtureBookingStatus.js';
import { normalizeProfileIdList } from './leadQueryUtils.js';

/** Appointment + nurture consultation flags per lead profile (clients list / profile detail). */
export async function buildProfileConsultationFlags(userObjectId, profileIds, { includeAppointment = true } = {}) {
  const ids = normalizeProfileIdList(profileIds);
  const nurtureMap = await buildNurtureConsultationBookedFromEmailByProfileIds(userObjectId, ids);
  const appointmentMap = includeAppointment
    ? await buildAppointmentStatusByProfileIds(userObjectId, ids)
    : new Map(ids.map((id) => [id, 'not_booked']));
  return { appointmentMap, nurtureMap };
}

export function calculateProfileRating(profile = {}) {
  const ratings = [
    ...(Array.isArray(profile.testimonials) ? profile.testimonials : []),
    ...(Array.isArray(profile.feedback_submissions) ? profile.feedback_submissions : []),
  ]
    .map((item) => Number(item?.rating))
    .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  if (!ratings.length) return null;
  return Number((ratings.reduce((total, rating) => total + rating, 0) / ratings.length).toFixed(1));
}

export function serializeClientFeedbackItem(item) {
  return {
    id: item._id,
    client_name: item.client_name,
    client_photo_url: null,
    rating: item.rating,
    text: item.text,
    date: item.submitted_at,
    role: 'Client feedback',
  };
}

export async function getRoutesFromGoogle(source, destination, apiKey) {

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${source}&destination=${destination}&alternatives=true&key=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.routes) return [];

  return data.routes.map((route, index) => {
    const leg = route.legs[0];

    return {
      id: index,
      mode: "Mixed",
      distance: leg.distance.text,
      duration: leg.duration.value / 60,
      cost: Math.floor(Math.random() * 200 + 50),
      carbon: Math.floor(Math.random() * 40 + 10)
    };
  });
}

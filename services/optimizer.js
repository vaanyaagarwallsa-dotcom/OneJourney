export function scoreRoutes(routes, constraints) {
  let processed = routes.map(route => {

    const costScore = 100 - route.cost;
    const timeScore = 100 - route.duration;
    const carbonScore = 100 - route.carbon;

    const smartScore =
      (costScore * 0.4) +
      (timeScore * 0.3) +
      (carbonScore * 0.3);

    return {
      ...route,
      smartScore: smartScore.toFixed(2),
      savings: Math.max(...routes.map(r => r.cost)) - route.cost
    };
  });

  if (constraints.maxBudget) {
    processed = processed.filter(r => r.cost <= constraints.maxBudget);
  }

  if (constraints.fastest) {
    processed.sort((a, b) => a.duration - b.duration);
  }

  if (constraints.ecoMode) {
    processed.sort((a, b) => a.carbon - b.carbon);
  }

  return processed;
}

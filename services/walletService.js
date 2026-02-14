let wallet = {
  balance: 2500,
  totalSaved: 0,
  trips: []
};

export function getWallet() {
  return wallet;
}

export function useRoute(route) {
  wallet.balance -= route.cost;
  wallet.totalSaved += route.savings;

  wallet.trips.push({
    mode: route.mode,
    cost: route.cost,
    savings: route.savings,
    date: new Date()
  });

  return wallet;
}

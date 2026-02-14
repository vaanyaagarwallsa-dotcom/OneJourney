import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// =================== IN-MEMORY STATE ===================
let wallet = {
  balance: 2500,
  totalSaved: 0,
  trips: [],
  carbonSaved: 0 // Total carbon saved in grams
};

// Weekly Challenges
let challenges = {
  current: {
    weekStart: new Date().toISOString(),
    weekEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    targets: [
      {
        id: 'save_money',
        title: 'Smart Saver',
        description: 'Save ₹500 this week',
        target: 500,
        current: 0,
        reward: '🏆 +100 bonus',
        icon: '💰'
      },
      {
        id: 'eco_warrior',
        title: 'Eco Warrior',
        description: 'Save 500g CO₂ this week',
        target: 500,
        current: 0,
        reward: '🌳 Plant a tree',
        icon: '🌿'
      },
      {
        id: 'frequent_rider',
        title: 'Travel Pro',
        description: 'Take 10 trips this week',
        target: 10,
        current: 0,
        reward: '⭐ Premium Badge',
        icon: '🚀'
      }
    ]
  },
  completed: []
};

// =================== HELPER FUNCTIONS ===================

// Score and optimize routes
function scoreRoutes(routes, constraints = {}) {
  let processed = routes.map(route => {
    const costScore = 100 - (route.cost / 5);
    const timeScore = 100 - (route.duration / 2);
    const carbonScore = 100 - (route.carbon / 2);

    const smartScore = (costScore * 0.4) + (timeScore * 0.3) + (carbonScore * 0.3);

    const maxCost = Math.max(...routes.map(r => r.cost));
    const savings = maxCost - route.cost;

    return {
      ...route,
      smartScore: Math.round(smartScore),
      savings: Math.round(savings)
    };
  });

  // Apply filters
  if (constraints.maxBudget) {
    processed = processed.filter(r => r.cost <= constraints.maxBudget);
  }

  if (constraints.fastest) {
    processed.sort((a, b) => a.duration - b.duration);
  }

  if (constraints.ecoMode) {
    processed.sort((a, b) => a.carbon - b.carbon);
  } else {
    // Default: sort by smart score
    processed.sort((a, b) => b.smartScore - a.smartScore);
  }

  return processed;
}

// Get real routes from Google Maps API
async function getRoutesFromGoogleMaps(source, destination, apiKey) {
  if (!apiKey) {
    console.log('⚠️  Google Maps API key not found, using mock data');
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}&alternatives=true&mode=transit&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      console.log('⚠️  Google Maps API returned no routes, using mock data');
      return null;
    }

    // Process Google Maps routes
    const processedRoutes = data.routes.slice(0, 3).map((route, index) => {
      const leg = route.legs[0];
      const distanceKm = leg.distance.value / 1000;
      const durationMin = Math.round(leg.duration.value / 60);

      // Estimate mode from transit details
      let mode = '🚕 Cab';
      let baseCost = Math.round(distanceKm * 12); // ₹12/km for cab
      let carbon = Math.round(distanceKm * 120); // 120g CO₂ per km for car

      if (leg.steps && leg.steps.some(step => step.travel_mode === 'TRANSIT')) {
        const hasMetro = leg.steps.some(step => 
          step.transit_details && 
          (step.transit_details.line.vehicle.type === 'SUBWAY' || 
           step.transit_details.line.vehicle.type === 'METRO_RAIL')
        );
        
        const hasBus = leg.steps.some(step => 
          step.transit_details && 
          step.transit_details.line.vehicle.type === 'BUS'
        );

        if (hasMetro && leg.steps.some(step => step.travel_mode === 'WALKING')) {
          mode = '🚇 Metro + Walk';
          baseCost = Math.round(40 + (distanceKm * 2)); // Metro ticket + walk
          carbon = Math.round(distanceKm * 15); // Low carbon
        } else if (hasMetro) {
          mode = '🚇 Metro + Auto';
          baseCost = Math.round(60 + (distanceKm * 3));
          carbon = Math.round(distanceKm * 20);
        } else if (hasBus) {
          mode = '🚌 Bus';
          baseCost = Math.round(20 + (distanceKm * 2));
          carbon = Math.round(distanceKm * 25);
        }
      }

      return {
        id: index,
        mode,
        duration: durationMin,
        cost: baseCost,
        carbon,
        distance: leg.distance.text,
        steps: leg.steps.map(step => step.html_instructions || step.instructions).filter(Boolean).slice(0, 3)
      };
    });

    return processedRoutes;

  } catch (error) {
    console.error('Google Maps API error:', error);
    return null;
  }
}

// Simulate getting routes (fallback when Google Maps fails or no key)
function generateMockRoutes(source, destination) {
  const modes = [
    { mode: '🚕 Cab', baseTime: 25, baseCost: 180, carbon: 45 },
    { mode: '🚇 Metro + Auto', baseTime: 35, baseCost: 65, carbon: 15 },
    { mode: '🚌 Bus', baseTime: 50, baseCost: 30, carbon: 20 },
    { mode: '🏍️ Bike Taxi', baseTime: 28, baseCost: 120, carbon: 30 },
    { mode: '🚶 Walk + Metro', baseTime: 45, baseCost: 40, carbon: 8 }
  ];

  return modes.map((m, idx) => {
    const variance = 0.8 + Math.random() * 0.4; // 80-120% variance
    return {
      id: idx,
      mode: m.mode,
      duration: Math.round(m.baseTime * variance),
      cost: Math.round(m.baseCost * variance),
      carbon: Math.round(m.carbon * variance),
      distance: (8 + Math.random() * 10).toFixed(1) + ' km',
      steps: [
        `Board ${m.mode.split(' ')[0]} from ${source}`,
        `Travel via optimal route`,
        `Arrive at ${destination}`
      ]
    };
  });
}

// Enhance routes with additional modes (add bike taxi, walk options)
function enhanceWithAdditionalModes(routes, source, destination) {
  const enhanced = [...routes];
  
  // Add bike taxi option
  if (routes.length > 0) {
    const avgDistance = routes[0].distance ? parseFloat(routes[0].distance) : 10;
    const avgDuration = routes[0].duration;
    
    enhanced.push({
      id: routes.length,
      mode: '🏍️ Bike Taxi',
      duration: Math.round(avgDuration * 0.85), // 15% faster
      cost: Math.round(avgDistance * 11), // ₹11/km
      carbon: Math.round(avgDistance * 30),
      distance: routes[0].distance,
      steps: ['Book bike taxi', 'Direct ride', 'Arrive at destination']
    });

    // Add walk + metro if not already present
    if (!routes.some(r => r.mode.includes('Walk'))) {
      enhanced.push({
        id: routes.length + 1,
        mode: '🚶 Walk + Metro',
        duration: Math.round(avgDuration * 1.2),
        cost: Math.round(avgDistance * 3.5),
        carbon: Math.round(avgDistance * 8),
        distance: routes[0].distance,
        steps: ['Walk to metro station', 'Take metro', 'Walk to destination']
      });
    }
  }

  return enhanced;
}

// Ask AI using OpenRouter
async function askAI(message, apiKey) {
  if (!apiKey) {
    return "AI service unavailable - API key not configured. Set OPENROUTER_API_KEY in .env file.";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "OneJourney Smart Mobility"
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct",
        messages: [
          {
            role: "system",
            content: "You are an AI urban mobility assistant for OneJourney. Help users with route planning, transport options, cost optimization, and eco-friendly travel. Be concise and helpful. Focus on practical advice for Indian cities like Chennai, Bangalore, Mumbai, Delhi."
          },
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", error);
      return "Sorry, I'm having trouble connecting to AI services right now. Please try again later.";
    }

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error("AI request failed:", error);
    return "Sorry, I encountered an error. Please try again.";
  }
}

// =================== CHALLENGE HELPERS ===================

function updateChallenges(route) {
  const targets = challenges.current.targets;
  
  // Update save_money challenge
  const saveMoneyChallenge = targets.find(c => c.id === 'save_money');
  if (saveMoneyChallenge) {
    saveMoneyChallenge.current = Math.min(saveMoneyChallenge.current + (route.savings || 0), saveMoneyChallenge.target);
  }
  
  // Update eco_warrior challenge (carbon saved vs worst option)
  const ecoChallenge = targets.find(c => c.id === 'eco_warrior');
  if (ecoChallenge) {
    // Assume worst case is 3x the carbon of chosen route
    const carbonSaved = (route.carbon || 0) * 2;
    ecoChallenge.current = Math.min(ecoChallenge.current + carbonSaved, ecoChallenge.target);
  }
  
  // Update frequent_rider challenge
  const riderChallenge = targets.find(c => c.id === 'frequent_rider');
  if (riderChallenge) {
    riderChallenge.current = Math.min(riderChallenge.current + 1, riderChallenge.target);
  }
}

function checkCompletedChallenges() {
  const completed = [];
  
  challenges.current.targets.forEach(challenge => {
    if (challenge.current >= challenge.target && !challenges.completed.includes(challenge.id)) {
      completed.push(challenge);
      challenges.completed.push(challenge.id);
      
      // Award bonus based on challenge
      if (challenge.id === 'save_money') {
        wallet.balance += 100; // ₹100 bonus
      } else if (challenge.id === 'eco_warrior') {
        wallet.balance += 50; // ₹50 bonus for eco achievement
      }
    }
  });
  
  return completed;
}

function resetWeeklyChallenges() {
  const now = new Date();
  const weekEnd = new Date(challenges.current.weekEnd);
  
  if (now > weekEnd) {
    // Archive completed challenges
    if (challenges.completed.length > 0) {
      // Reset for new week
      challenges.current = {
        weekStart: new Date().toISOString(),
        weekEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        targets: [
          {
            id: 'save_money',
            title: 'Smart Saver',
            description: 'Save ₹500 this week',
            target: 500,
            current: 0,
            reward: '🏆 +100 bonus',
            icon: '💰'
          },
          {
            id: 'eco_warrior',
            title: 'Eco Warrior',
            description: 'Save 500g CO₂ this week',
            target: 500,
            current: 0,
            reward: '🌳 Plant a tree',
            icon: '🌿'
          },
          {
            id: 'frequent_rider',
            title: 'Travel Pro',
            description: 'Take 10 trips this week',
            target: 10,
            current: 0,
            reward: '⭐ Premium Badge',
            icon: '🚀'
          }
        ]
      };
      challenges.completed = [];
    }
  }
}

// =================== API ROUTES ===================

// GET /api/optimize - Get optimized routes
app.post("/api/optimize", async (req, res) => {
  try {
    const { source, destination, constraints = {} } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ error: "Source and destination are required" });
    }

    // Try to get real routes from Google Maps
    let rawRoutes = await getRoutesFromGoogleMaps(source, destination, process.env.GOOGLE_MAPS_API_KEY);
    
    // Fallback to mock routes if Google Maps fails
    if (!rawRoutes) {
      rawRoutes = generateMockRoutes(source, destination);
    } else {
      // Enhance Google Maps routes with additional modes
      rawRoutes = enhanceWithAdditionalModes(rawRoutes, source, destination);
    }
    
    // Score and optimize
    const optimized = scoreRoutes(rawRoutes, constraints);

    res.json({
      success: true,
      routes: optimized,
      source,
      destination,
      usingRealData: rawRoutes !== null
    });

  } catch (error) {
    console.error("Optimize error:", error);
    res.status(500).json({ error: "Route optimization failed" });
  }
});

// GET /api/wallet - Get wallet info
app.get("/api/wallet", (req, res) => {
  res.json(wallet);
});

// POST /api/wallet/use - Use a route (deduct from wallet)
app.post("/api/wallet/use", (req, res) => {
  try {
    const route = req.body;

    if (!route || !route.cost) {
      return res.status(400).json({ error: "Invalid route data" });
    }

    if (wallet.balance < route.cost) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    wallet.balance -= route.cost;
    wallet.totalSaved += route.savings || 0;
    wallet.carbonSaved += route.carbon || 0;

    wallet.trips.push({
      mode: route.mode,
      cost: route.cost,
      savings: route.savings || 0,
      carbon: route.carbon || 0,
      duration: route.duration,
      distance: route.distance,
      date: new Date().toISOString()
    });

    // Update challenges
    updateChallenges(route);

    // Check for completed challenges
    const completedNow = checkCompletedChallenges();

    res.json({
      ...wallet,
      completedChallenges: completedNow
    });

  } catch (error) {
    console.error("Wallet error:", error);
    res.status(500).json({ error: "Wallet transaction failed" });
  }
});

// POST /api/wallet/topup - Add money to wallet
app.post("/api/wallet/topup", (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    wallet.balance += amount;

    res.json({
      success: true,
      wallet
    });

  } catch (error) {
    console.error("Topup error:", error);
    res.status(500).json({ error: "Topup failed" });
  }
});

// POST /api/ai - Ask AI assistant
app.post("/api/ai", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const reply = await askAI(message, process.env.OPENROUTER_API_KEY);

    res.json({
      success: true,
      reply
    });

  } catch (error) {
    console.error("AI error:", error);
    res.status(500).json({ error: "AI request failed" });
  }
});

// GET /api/history - Get trip history
app.get("/api/history", (req, res) => {
  res.json({
    success: true,
    trips: wallet.trips.slice(-20).reverse() // Last 20 trips, most recent first
  });
});

// GET /api/challenges - Get current challenges
app.get("/api/challenges", (req, res) => {
  resetWeeklyChallenges(); // Check if we need to reset
  res.json({
    success: true,
    challenges: challenges.current,
    totalCarbonSaved: wallet.carbonSaved
  });
});

// =================== SERVER START ===================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 OneJourney Server running on http://localhost:${PORT}`);
  console.log(`💰 Wallet Balance: ₹${wallet.balance}`);
  console.log(`🔑 OpenRouter API: ${process.env.OPENROUTER_API_KEY ? 'Configured ✓' : 'Missing ✗'}`);
  console.log(`🗺️  Google Maps API: ${process.env.GOOGLE_MAPS_API_KEY ? 'Configured ✓ (Using Real Routes)' : 'Missing ✗ (Using Mock Data)'}`);
  console.log(`🎯 Weekly Challenges: Active`);
});
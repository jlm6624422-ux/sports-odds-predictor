"""
Sports Odds Prediction Model Service
FastAPI service providing logistic regression predictions for sporting events.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn

from models.regression import PredictionModel

app = FastAPI(
    title="Sports Odds Prediction Model",
    description="Logistic regression model for sports outcome prediction",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize model
model = PredictionModel()


class OddsInput(BaseModel):
    bookmaker: str
    home_price: Optional[float] = None
    away_price: Optional[float] = None
    spread_home: Optional[float] = None


class PredictionRequest(BaseModel):
    game_id: int
    sport: str
    home_team: str
    away_team: str
    odds: list[OddsInput] = []


class PredictionResponse(BaseModel):
    predicted_winner: str
    home_win_prob: float
    away_win_prob: float
    confidence: float
    spread_prediction: Optional[float] = None
    total_prediction: Optional[float] = None
    model_version: str = "v1.0"
    features_used: list[str] = []


@app.get("/health")
async def health():
    return {"status": "ok", "model_version": "v1.0", "model_loaded": model.is_ready()}


@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """Generate a prediction for a given game based on odds data."""
    try:
        result = model.predict(
            sport=request.sport,
            home_team=request.home_team,
            away_team=request.away_team,
            odds=[o.model_dump() for o in request.odds],
        )
        return PredictionResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/model/info")
async def model_info():
    """Get information about the current model."""
    return {
        "version": "v1.0",
        "type": "Logistic Regression",
        "features": [
            "odds_consensus",
            "home_advantage",
            "odds_variance",
            "market_efficiency",
        ],
        "sports_supported": ["NFL", "NBA", "MLB", "NHL"],
        "description": "Uses odds consensus from multiple bookmakers as primary features, "
                       "combined with historical home advantage factors per sport.",
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, reload=True)

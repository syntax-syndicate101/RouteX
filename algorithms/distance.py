"""Distance helpers for the flight path planner.

All weights in the route graph come from this module: the great-circle
distance between two airports is computed with the Haversine formula,
which is accurate to well under 1% for the distances used in aviation.
"""

import math

# Mean radius of the Earth in kilometres (IUGG mean radius).
EARTH_RADIUS_KM = 6371.0088


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance between two points in kilometres.

    The Haversine formula:

        a = sin^2(dlat / 2) + cos(lat1) * cos(lat2) * sin^2(dlon / 2)
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        d = R * c

    where dlat and dlon are the latitude/longitude differences (radians).
    """
    # Convert degrees to radians.
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    # Haversine of the central angle.
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    # Guard against floating point drift pushing `a` slightly above 1.
    a = min(1.0, max(0.0, a))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return EARTH_RADIUS_KM * c


def point_to_point_minutes(distance_km: float) -> float:
    """Estimate the airborne time in minutes for a single flight leg.

    Uses a cruise speed of ~850 km/h plus a fixed 25 min taxi/climb/
    descent overhead that applies to every leg regardless of length.
    """
    cruise_speed_kmh = 850.0
    leg_overhead_minutes = 25.0
    return 60.0 * distance_km / cruise_speed_kmh + leg_overhead_minutes


def layover_minutes() -> float:
    """Estimated connection time (minutes) when a route has a stopover."""
    return 60.0

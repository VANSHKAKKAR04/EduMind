from datetime import datetime, date, timezone
import json
from typing import Any
import math
import pandas as pd
class CustomJSONEncoder(json.JSONEncoder):
    """
    Custom JSON encoder that handles datetime objects by converting them to ISO format strings.
    """
    def default(self, obj: Any) -> Any:
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)

def custom_jsonable_encoder(obj: Any) -> Any:
    """
    Custom encoder function that converts objects to JSON-compatible data structures.
    This is particularly useful for handling datetime objects and pandas objects.
    """
    if isinstance(obj, dict):
        return {k: custom_jsonable_encoder(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [custom_jsonable_encoder(i) for i in obj]
    elif isinstance(obj, (datetime, date)):
        return obj.isoformat()
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    elif isinstance(obj, pd.Series):
        return {k: custom_jsonable_encoder(v) for k, v in obj.to_dict().items()}
    elif isinstance(obj, pd.DataFrame):
        return [custom_jsonable_encoder(row) for _, row in obj.iterrows()]
    return obj
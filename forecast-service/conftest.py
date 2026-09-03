# pytest 가 forecast-service 를 sys.path 에 넣어 `import app...` 이 되게 합니다.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

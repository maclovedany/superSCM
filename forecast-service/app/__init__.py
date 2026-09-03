"""SuperSCM Python Forecast Service (STEP 8).

SQL Baseline 이 만든 예측 실행(run)에 Python 모델 결과를 이어 붙입니다.
학습 데이터는 core.v_demand_grid / core.v_train_demand 로만 읽습니다.
raw 스키마는 이 서비스가 절대 읽지 않습니다.
"""

__version__ = "1.0.0"

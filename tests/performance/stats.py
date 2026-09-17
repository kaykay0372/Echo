# Statistics helpers shared by benchmark_pipeline.py and async_job_monitor.py.
# No input, output or external dependencies beyond numpy/scipy.

import warnings

import numpy as np
from scipy import stats as scipy_stats


def summarise_latencies(values: list[float]) -> dict:
    """Median/p95/p99 + a bootstrap 95% CI on the median, following Dean & Barroso (2013), and Efron & Tibshirani (1993),
    "An Introduction to the Bootstrap", for the CI method. Returns nulled out fields if values are empty.
    """

    if not values:
        return {
            "n": 0,
            "median_s": None,
            "p95_s": None,
            "p99_s": None,
            "median_ci95_s": None,
        }

    arr = np.array(values)
    ci = bootstrap_ci(values, statistic=np.median) if len(values) >= 2 else None

    return {
        "n": len(values),
        "median_s": float(np.median(arr)),
        "p95_s": float(np.percentile(arr, 95)),
        "p99_s": float(np.percentile(arr, 99)),
        "median_ci95_s": ci,
    }


def bootstrap_ci(
    values: list[float],
    statistic=np.median,
    confidence: float = 0.95,
    n_resamples: int = 9999,
) -> tuple[float, float] | None:
    """95% bootstrap CI for the given statistic (Efron & Tibshirani, 1993). None if n < 2."""

    if len(values) < 2:
        return None

    # BCa can fail if the statistic is constant across resamples, so fall back to the percentile method.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", category=RuntimeWarning)
            result = scipy_stats.bootstrap(
                (values,),
                statistic,
                confidence_level=confidence,
                n_resamples=n_resamples,
                method="BCa",
            )
        if np.isnan(result.confidence_interval.low) or np.isnan(
            result.confidence_interval.high
        ):
            raise ValueError("BCa produced a NaN interval")
    except (ValueError, ZeroDivisionError, RuntimeWarning):
        result = scipy_stats.bootstrap(
            (values,),
            statistic,
            confidence_level=confidence,
            n_resamples=n_resamples,
            method="percentile",
        )

    return (
        float(result.confidence_interval.low),
        float(result.confidence_interval.high),
    )


def fit_linear(x: list[float], y: list[float]) -> dict | None:
    """Scipy's linregress() returns rvalue unsquared, square it for computation of R²."""

    if len(x) < 3:
        return None

    result = scipy_stats.linregress(x, y)
    return {
        "slope": float(result.slope),
        "intercept": float(result.intercept),
        "r_squared": float(result.rvalue**2),
        "p_value": float(result.pvalue),
    }


def fifo_burst_wait_predictions(
    service_times_in_arrival_order: list[float],
) -> list[float]:
    """Exact predicted queue-wait time for each job in a set that all arrive at once."""

    predicted = []
    total_ahead = 0.0
    for service_time in service_times_in_arrival_order:
        predicted.append(total_ahead)
        total_ahead += service_time
    return predicted


def mg1_expected_wait(arrival_rate: float, service_times: list[float]) -> float | None:
    """Steady-state expected queue-wait time for an M/G/1 queue (Pollaczek-Khinchine formula; Kleinrock, 1975,
    "Queueing Systems, Vol. 1: Theory", p.191): E[Wq] = (lambda * E[S^2]) / (2 * (1 - rho)), rho = lambda * E[S].
    """

    if not service_times:
        return None

    mean_service = sum(service_times) / len(service_times)
    mean_service_sq = sum(s**2 for s in service_times) / len(service_times)
    # arrival rate × average time per job
    rho = arrival_rate * mean_service
    if rho >= 1:
        return None

    return (arrival_rate * mean_service_sq) / (2 * (1 - rho))


def environment_snapshot() -> dict:
    """Hardware/software context logged once per run."""

    import platform
    import sys

    snapshot = {
        "platform": platform.platform(),
        "python_version": sys.version.split()[0],
        "cpu": platform.processor() or "unknown",
    }

    # CPU stats
    try:
        import psutil

        snapshot["cpu_count_logical"] = psutil.cpu_count(logical=True)
        snapshot["cpu_count_physical"] = psutil.cpu_count(logical=False)
        snapshot["ram_total_gb"] = round(psutil.virtual_memory().total / (1024**3), 1)
    except ImportError:
        pass

    # CPU make details
    try:
        import cpuinfo

        snapshot["cpu_brand"] = cpuinfo.get_cpu_info().get("brand_raw", "unknown")
    except ImportError:
        pass

    # GPU stats
    try:
        import torch

        snapshot["torch_version"] = torch.__version__
        snapshot["cuda_available"] = torch.cuda.is_available()
        snapshot["cuda_device_name"] = (
            torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
        )
    except ImportError:
        snapshot["torch_version"] = None
        snapshot["cuda_available"] = None
        snapshot["cuda_device_name"] = None

    return snapshot

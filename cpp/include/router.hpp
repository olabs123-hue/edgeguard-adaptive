#pragma once
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <vector>

namespace edgeguard {
enum class Circuit { Closed, Open, HalfOpen };
struct Policy {
  std::size_t min_samples = 5;
  std::size_t window_size = 20;
  double failure_threshold = 0.5;
  std::chrono::milliseconds open_interval{2000};
  std::size_t half_open_limit = 1;
  double latency_weight = 0.002;
};
struct Backend {
  std::string address;
  Circuit state = Circuit::Closed;
  std::deque<bool> outcomes;
  double ewma_ms = 0;
  bool has_latency = false;
  std::chrono::steady_clock::time_point opened_at{};
  std::size_t in_flight_probes = 0;
  std::uint64_t successes = 0, failures = 0;
};
class AdaptiveRouter {
public:
  explicit AdaptiveRouter(std::vector<std::string> addresses, Policy policy = {});
  std::optional<std::size_t> acquire(std::chrono::steady_clock::time_point now);
  void complete(std::size_t backend, bool ok, double latency_ms,
                std::chrono::steady_clock::time_point now);
  const Backend& backend(std::size_t index) const;
  std::size_t size() const { return backends_.size(); }
private:
  std::vector<Backend> backends_;
  Policy policy_;
  std::size_t cursor_ = 0;
};
const char* circuit_name(Circuit value);
} // namespace edgeguard

#include "router.hpp"
#include <cassert>
#include <chrono>
#include <iostream>
#include <stdexcept>
using namespace edgeguard;
using Clock = std::chrono::steady_clock;
int main() {
  Policy p;
  p.min_samples = 2;
  p.window_size = 3;
  p.failure_threshold = 0.5;
  p.open_interval = std::chrono::milliseconds(1000);
  AdaptiveRouter r({"a", "b"}, p);
  auto now = Clock::now();
  auto a = r.acquire(now);
  assert(a && *a == 0);
  r.complete(*a, false, 200, now);
  auto b = r.acquire(now);
  assert(b && *b == 1);
  r.complete(*b, true, 10, now);
  AdaptiveRouter isolated({"only"}, p);
  for (int i = 0; i < 2; ++i) {
    auto picked = isolated.acquire(now);
    assert(picked && *picked == 0);
    isolated.complete(0, false, 100, now);
  }
  assert(isolated.backend(0).state == Circuit::Open);
  assert(!isolated.acquire(now + std::chrono::milliseconds(999)));
  auto probe = isolated.acquire(now + std::chrono::milliseconds(1001));
  assert(probe && *probe == 0);
  assert(!isolated.acquire(now + std::chrono::milliseconds(1001)));
  isolated.complete(0, true, 5, now + std::chrono::milliseconds(1001));
  assert(isolated.backend(0).state == Circuit::Closed);
  assert(isolated.acquire(now + std::chrono::milliseconds(1002)));
  bool invalid = false;
  try { AdaptiveRouter bad({}, p); } catch (const std::invalid_argument&) { invalid = true; }
  assert(invalid);
  invalid = false;
  try { AdaptiveRouter bad({"a", "a"}, p); } catch (const std::invalid_argument&) { invalid = true; }
  assert(invalid);
  invalid = false;
  try { p.latency_weight = 0.0 / 0.0; AdaptiveRouter bad({"a"}, p); } catch (const std::invalid_argument&) { invalid = true; }
  assert(invalid);
  std::cout << "all routing tests passed\n";
}

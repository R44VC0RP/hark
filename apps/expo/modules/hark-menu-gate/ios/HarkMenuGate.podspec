Pod::Spec.new do |s|
  s.name           = 'HarkMenuGate'
  s.version        = '1.0.0'
  s.summary        = 'Keeps the tap that closes a menu away from React Native'
  s.description    = 'A window gesture recognizer that stops a tap outside an open menu or popover from also pressing the React Native view under it.'
  s.author         = ''
  s.homepage       = 'https://hark.fyi'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

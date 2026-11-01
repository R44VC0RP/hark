Pod::Spec.new do |s|
  s.name           = 'HarkKeyCommands'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard shortcuts for Hark'
  s.description    = 'Registers UIKeyCommands chosen from JavaScript and reports when one fires.'
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

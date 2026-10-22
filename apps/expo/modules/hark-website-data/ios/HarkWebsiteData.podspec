Pod::Spec.new do |s|
  s.name           = 'HarkWebsiteData'
  s.version        = '1.0.0'
  s.summary        = 'Clears web app data stored by WKWebView'
  s.description    = 'Removes WKWebsiteDataStore records on Hark sign-out and web app revoke.'
  s.author         = ''
  s.homepage       = 'https://hark.ryan.ceo'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

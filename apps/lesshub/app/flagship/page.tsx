import { Flagship, LogLevel } from '@flagship.io/js-sdk'
import { Button } from '@ui/components/button'
import LoginBtn from './components/LoginBtn'

let env = ''
let apiKey = ''
export default async function FlagshipIntegrationPage() {
  let btnColor = 'yellow'
  let google = false
  let wechat = false

  // It should be better to call this function just once in the most appropriate location for your application.
  const fsInstance = Flagship.start(
    env, // env
    apiKey, // API Key
    {
      // logLevel 👉: https://docs.developers.flagship.io/docs/js-v3#loglevel
      logLevel: LogLevel.ERROR
    }
  )

  const visitor = Flagship.newVisitor({
    // hasConsented is set to true so that to track some user action.
    hasConsented: true,
    context: {
      // the geographic zone where user is connected.
      // zone: selectedZone.value
    }
  })

  visitor.on('ready', function (error) {
    if (error) {
      console.log('error', error)
    }

    // step 5 get flags
    const flagLoginWithGoogle = visitor.getFlag('login-with-google', false)
    const flagLoginWithWechat = visitor.getFlag('login-with-wechat', false)
    const flagLoginBtnColor = visitor.getFlag('login-btn-color', '#0d6efd')

    google = flagLoginWithGoogle.getValue()
    wechat = flagLoginWithWechat.getValue()
    btnColor = flagLoginBtnColor.getValue()
  })

  visitor.fetchFlags()

  return (
    <div className='w-full flex flex-col items-center gap-8'>
      <h1 className='mt-4'>FlagshipIntegratePage</h1>
      <LoginBtn content='Login btn color' color={btnColor} disable={!google} />
      <LoginBtn content='Login btn color' color={btnColor} disable={!wechat} />
    </div>
  )
}

// 👇： Learn more:
//        https://docs.developers.flagship.io/docs/js-v3

// Flagship.start("<ENV_ID>", "<API_KEY>", {
//   decisionMode: DecisionMode.BUCKETING,
//   fetchNow: false,
//   timeout: 10,
//   enableClientCache: true,
//   logLevel: LogLevel.CRITICAL,
//   logManager: sentryMiddleware,
//   decisionApiUrl: 'https://example.com',
//   pollingInterval: 100,
//   activateDeduplicationTime: 0,
//   hitDeduplicationTime: 0,
//   initialBucketing: {},
//   statusChangedCallback: function(status){
//     console.log(status)
//   },
//   onBucketingSuccess: function(status, payload){
//     console.log(status, payload)
//   },
//   onBucketingFail: function(error){
//     console.log(error)
//   },
//   onBucketingUpdated: function(lastUpdate){
//     console.log(lastUpdate)
//   }
// });
